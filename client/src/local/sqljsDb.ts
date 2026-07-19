/**
 * Browser database backend: sql.js (SQLite compiled to WebAssembly) exposed
 * through the shared DBHandle contract and persisted to IndexedDB.
 *
 * Persistence model: every write marks the DB dirty; a debounced task exports
 * the whole database (it's small — personal-tracking scale) into IndexedDB.
 * pagehide/visibility flushes cover mobile tab discards.
 */
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { applySchema, setDbHandle, type DBHandle, type DBStatement } from "@shared/data/db";

const IDB_NAME = "darfum";
const IDB_STORE = "sqlite";
const IDB_KEY = "main";

let sdb: Database | null = null;
let dirty = false;
let saveTimer: number | null = null;
let txDepth = 0;

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbLoad(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSave(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes.buffer.slice(0), IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Persistence scheduling
// ---------------------------------------------------------------------------

function markDirty(): void {
  dirty = true;
  if (txDepth > 0) return; // save once the outermost transaction commits
  if (saveTimer != null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void flush();
  }, 300);
}

export async function flush(): Promise<void> {
  if (!sdb || !dirty) return;
  dirty = false;
  try {
    await idbSave(sdb.export());
  } catch (err) {
    dirty = true; // retry on next write
    console.error("Failed to persist database:", err);
  }
}

// ---------------------------------------------------------------------------
// DBHandle implementation
// ---------------------------------------------------------------------------

type SqlParam = number | string | null;

function cleanParams(params: unknown[]): SqlParam[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (typeof p === "bigint") return Number(p);
    if (typeof p === "number" || typeof p === "string") return p;
    throw new Error(`Unsupported SQL parameter type: ${typeof p}`);
  });
}

const WRITE_RE = /^\s*(insert|update|delete|replace|create|drop|alter|vacuum)/i;

function makeStatement(sql: string): DBStatement {
  const isWrite = WRITE_RE.test(sql);
  return {
    get(...params: unknown[]): unknown {
      const stmt = sdb!.prepare(sql);
      try {
        stmt.bind(cleanParams(params));
        if (stmt.step()) return stmt.getAsObject();
        return undefined;
      } finally {
        stmt.free();
        if (isWrite) markDirty();
      }
    },
    all(...params: unknown[]): unknown[] {
      const stmt = sdb!.prepare(sql);
      const rows: unknown[] = [];
      try {
        stmt.bind(cleanParams(params));
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
        if (isWrite) markDirty();
      }
    },
    run(...params: unknown[]): { lastInsertRowid: number; changes: number } {
      const stmt = sdb!.prepare(sql);
      try {
        stmt.bind(cleanParams(params));
        stmt.step();
      } finally {
        stmt.free();
      }
      const changes = sdb!.getRowsModified();
      let lastInsertRowid = 0;
      const idStmt = sdb!.prepare("SELECT last_insert_rowid() AS id");
      try {
        idStmt.step();
        lastInsertRowid = Number((idStmt.getAsObject() as { id: number }).id);
      } finally {
        idStmt.free();
      }
      markDirty();
      return { lastInsertRowid, changes };
    },
  };
}

const handle: DBHandle = {
  prepare: (sql) => makeStatement(sql),
  exec: (sql) => {
    sdb!.exec(sql);
    markDirty();
  },
  pragma: (p) => {
    try {
      sdb!.exec(`PRAGMA ${p}`);
    } catch {
      /* pragmas like journal_mode are meaningless in wasm — ignore */
    }
    return undefined;
  },
  transaction: <A extends unknown[], R>(fn: (...args: A) => R) => {
    return (...args: A): R => {
      const name = `sp_${txDepth}`;
      sdb!.exec(`SAVEPOINT ${name}`);
      txDepth++;
      try {
        const result = fn(...args);
        txDepth--;
        sdb!.exec(`RELEASE ${name}`);
        markDirty();
        return result;
      } catch (err) {
        txDepth--;
        sdb!.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw err;
      }
    };
  },
};

// ---------------------------------------------------------------------------
// Init / backup
// ---------------------------------------------------------------------------

export async function initSqljsDb(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const bytes = await idbLoad().catch(() => null);
  sdb = bytes ? new SQL.Database(bytes) : new SQL.Database();
  setDbHandle(handle);
  handle.pragma("foreign_keys = ON");
  applySchema();
  await flush();

  // Best-effort durability on mobile browsers.
  void navigator.storage?.persist?.();
  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}

/** Full database bytes for the backup/export button. */
export function exportDbBytes(): Uint8Array {
  if (!sdb) throw new Error("Database not initialized");
  return sdb.export();
}

/** Replace the database from an imported backup. Caller should reload the app. */
export async function importDbBytes(bytes: Uint8Array): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const replacement = new SQL.Database(bytes);
  // sanity check before committing to it
  const check = replacement.prepare("SELECT name FROM sqlite_master WHERE type='table'");
  const tables: string[] = [];
  while (check.step()) tables.push(String((check.getAsObject() as { name: string }).name));
  check.free();
  if (!tables.includes("settings")) {
    replacement.close();
    throw new Error("That file doesn't look like a valid backup of this app.");
  }
  sdb?.close();
  sdb = replacement;
  handle.pragma("foreign_keys = ON");
  applySchema();
  dirty = true;
  await flush();
}
