/**
 * Browser database backend: sql.js (SQLite compiled to WebAssembly) exposed
 * through the shared DBHandle contract and persisted to IndexedDB.
 *
 * Persistence model: every write marks the DB dirty; a coalesced task exports
 * the whole database (it's small — personal-tracking scale) into IndexedDB
 * through one cached connection. pagehide/visibility-hidden run the same save
 * synchronously in the handler task (IDBTransaction.commit()) so closing the
 * tab right after a write cannot lose it.
 *
 * Single-writer invariant: a Web Lock ("darfum-db") is held for the page's
 * lifetime; a second tab/window refuses to initialize instead of silently
 * clobbering the first tab's exports (whole-DB writes don't merge).
 */
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { applySchema, setDbHandle, type DBHandle, type DBStatement } from "@shared/data/db";

const IDB_NAME = "darfum";
const IDB_STORE = "sqlite";
const IDB_KEY = "main";
const LOCK_NAME = "darfum-db";

/** Thrown by initSqljsDb when another tab/window already owns the database. */
export class AlreadyOpenError extends Error {
  constructor() {
    super(
      "Darfum is already open in another tab or window. Close that one (or use it) and reload here.",
    );
    this.name = "AlreadyOpenError";
  }
}

let sdb: Database | null = null;
let idbConn: IDBDatabase | null = null;
let dirty = false;
let writeGen = 0; // bumped on every write; guards the dirty-clear race
let saveTimer: number | null = null;
let txDepth = 0;

// ---------------------------------------------------------------------------
// IndexedDB helpers (one cached connection)
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

async function getConn(): Promise<IDBDatabase> {
  if (idbConn) return idbConn;
  const conn = await openIdb();
  conn.onclose = () => {
    if (idbConn === conn) idbConn = null;
  };
  conn.onversionchange = () => {
    conn.close();
    if (idbConn === conn) idbConn = null;
  };
  idbConn = conn;
  return conn;
}

function idbLoad(conn: IDBDatabase): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

function idbSave(conn: IDBDatabase, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes.buffer.slice(0), IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

// ---------------------------------------------------------------------------
// Export + persistence scheduling
// ---------------------------------------------------------------------------

/**
 * sql.js's export() closes and reopens the underlying connection, which RESETS
 * per-connection pragmas — notably foreign_keys, silently disabling every
 * ON DELETE CASCADE/SET NULL. Always export through this helper.
 */
function exportBytes(): Uint8Array {
  const bytes = sdb!.export();
  sdb!.exec("PRAGMA foreign_keys = ON");
  return bytes;
}

function markDirty(): void {
  dirty = true;
  writeGen++;
  if (txDepth > 0) return; // save once the outermost transaction commits
  if (saveTimer != null) return;
  // Coalesce same-burst writes only — the DB is small and export is cheap.
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void flush();
  }, 0);
}

export async function flush(): Promise<void> {
  if (!sdb || !dirty) return;
  const gen = writeGen;
  try {
    const conn = await getConn();
    await idbSave(conn, exportBytes());
    if (writeGen === gen) dirty = false; // only clear if nothing wrote meanwhile
  } catch (err) {
    console.error("Failed to persist database:", err);
  }
}

/**
 * Unload-path save: runs entirely inside the current task using the cached
 * connection. transaction creation + put are synchronous; commit() asks the
 * backend to commit without waiting for further renderer callbacks — the API
 * designed for exactly this pagehide scenario.
 */
function syncSave(): void {
  if (!sdb || !dirty || !idbConn) return;
  try {
    const bytes = exportBytes();
    const tx = idbConn.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes.buffer.slice(0), IDB_KEY);
    (tx as { commit?: () => void }).commit?.();
    const gen = writeGen;
    tx.oncomplete = () => {
      if (writeGen === gen) dirty = false;
    };
  } catch (err) {
    console.error("Unload-path persist failed:", err);
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

const WRITE_RE = /^\s*(insert|update|delete|replace|create|drop|alter|vacuum|with)/i;

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

/** Hold a page-lifetime exclusive lock; false if another tab owns the DB. */
function acquireWriterLock(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!("locks" in navigator) || !navigator.locks?.request) return resolve(true);
    void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      if (lock) return new Promise<never>(() => {}); // hold until page dies
      return undefined;
    });
  });
}

export async function initSqljsDb(): Promise<void> {
  const granted = await acquireWriterLock();
  if (!granted) throw new AlreadyOpenError();

  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const conn = await getConn();
  const bytes = await idbLoad(conn).catch(() => null);
  sdb = bytes ? new SQL.Database(bytes) : new SQL.Database();
  setDbHandle(handle);
  handle.pragma("foreign_keys = ON");
  applySchema();
  dirty = true;
  writeGen++;
  await flush();

  // Best-effort durability on mobile browsers.
  void navigator.storage?.persist?.();
  window.addEventListener("pagehide", syncSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") syncSave();
  });
}

/** Full database bytes for the backup/export button. */
export function exportDbBytes(): Uint8Array {
  if (!sdb) throw new Error("Database not initialized");
  return exportBytes();
}

/** Replace the database from an imported backup. Throws if the replacement
 *  cannot be persisted — callers must not reload on failure. */
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
  // Persist directly and PROPAGATE failure — a swallowed error here would
  // silently reload into the old data.
  const conn = await getConn();
  await idbSave(conn, exportBytes());
  dirty = false;
  writeGen++;
}
