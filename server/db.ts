/**
 * Node runtime database: better-sqlite3 file DB injected into the shared data
 * core. All data logic lives in shared/data — this file only wires it up and
 * re-exports the shared surface so existing `import ... from "../db"` sites
 * keep working unchanged.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema, setDbHandle, type DBHandle } from "../shared/data/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(path.join(dataDir, "health.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

setDbHandle(sqlite as unknown as DBHandle);
applySchema();

export {
  db,
  todayStr,
  localDateStr,
  daysAgoStr,
  dateRange,
  isValidDateStr,
  type DBHandle,
  type DBStatement,
} from "../shared/data/db";
