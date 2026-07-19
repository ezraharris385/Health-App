/**
 * Runtime-agnostic database access. The app runs in two modes:
 *  - server mode: Node injects a better-sqlite3 database (server/db.ts)
 *  - local mode:  the browser injects a sql.js (wasm) database persisted to
 *    IndexedDB (client/src/local/sqljsDb.ts)
 *
 * All data code uses the `db` delegate below and stays identical in both.
 * Only the minimal surface actually used by the app is part of the contract.
 */

export interface DBStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
}

export interface DBHandle {
  prepare(sql: string): DBStatement;
  exec(sql: string): void;
  pragma(pragma: string): unknown;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
}

let current: DBHandle | null = null;

export function setDbHandle(handle: DBHandle): void {
  current = handle;
}

function requireDb(): DBHandle {
  if (!current) {
    throw new Error("Database not initialized — setDbHandle() must run at startup.");
  }
  return current;
}

/** Delegate with the exact call-shape of better-sqlite3 that all data code uses. */
export const db: DBHandle = {
  prepare: (sql) => requireDb().prepare(sql),
  exec: (sql) => requireDb().exec(sql),
  pragma: (p) => requireDb().pragma(p),
  transaction: (fn) => requireDb().transaction(fn),
};

// ---------------------------------------------------------------------------
// Schema (applied by both runtimes after injection)
// ---------------------------------------------------------------------------

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Workout -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  muscle_groups TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workout_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  day_of_week INTEGER,               -- 0=Sunday..6=Saturday, NULL = unscheduled
  name TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_day_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_day_id INTEGER NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  sets INTEGER NOT NULL DEFAULT 3,
  reps TEXT NOT NULL DEFAULT '8-12',
  target_weight REAL,
  rest_seconds INTEGER,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  plan_day_id INTEGER REFERENCES plan_days(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS session_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL DEFAULT 1,
  reps INTEGER NOT NULL DEFAULT 0,
  weight REAL,
  rpe REAL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cardio_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('run','jog','walk','interval')),
  distance_km REAL NOT NULL DEFAULT 0,
  duration_minutes REAL NOT NULL DEFAULT 0,
  intensity INTEGER NOT NULL DEFAULT 5,
  steps INTEGER,                     -- manually entered total; NULL = use estimates
  estimated_steps_run INTEGER,
  estimated_steps_walked INTEGER,
  report TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

-- Nutrition ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  serving_size REAL NOT NULL DEFAULT 1,
  serving_unit TEXT NOT NULL DEFAULT 'serving',
  calories REAL NOT NULL DEFAULT 0,
  protein_g REAL NOT NULL DEFAULT 0,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  fiber_g REAL NOT NULL DEFAULT 0,
  sugar_g REAL NOT NULL DEFAULT 0,
  sodium_mg REAL NOT NULL DEFAULT 0,
  micros_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS food_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  servings REAL NOT NULL DEFAULT 1,
  meal TEXT NOT NULL DEFAULT 'snack' CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_food_logs_date ON food_logs(date);

CREATE TABLE IF NOT EXISTS water_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  amount_ml REAL NOT NULL,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_water_logs_date ON water_logs(date);

CREATE TABLE IF NOT EXISTS weight_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  weight REAL NOT NULL,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Mobility (stretching / yoga / posture) --------------------------------------
CREATE TABLE IF NOT EXISTS stretches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'stretch' CHECK (category IN ('stretch','yoga','posture')),
  target_areas TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  default_hold_seconds INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mobility_routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mobility_routine_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES mobility_routines(id) ON DELETE CASCADE,
  stretch_id INTEGER NOT NULL REFERENCES stretches(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  hold_seconds INTEGER,
  reps INTEGER,
  per_side INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mobility_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'stretch' CHECK (kind IN ('stretch','yoga','posture','mixed')),
  routine_id INTEGER REFERENCES mobility_routines(id) ON DELETE SET NULL,
  duration_minutes REAL NOT NULL DEFAULT 0,
  feel INTEGER,
  report TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  performed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mobility_sessions_date ON mobility_sessions(date);

CREATE TABLE IF NOT EXISTS mobility_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'higher_better' CHECK (direction IN ('higher_better','lower_better')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mobility_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  metric_id INTEGER NOT NULL REFERENCES mobility_metrics(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  notes TEXT NOT NULL DEFAULT '',
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mobility_assessments_date ON mobility_assessments(date);

-- Sleep ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sleep_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                -- wake date the sleep counts toward
  bed_time TEXT NOT NULL,            -- ISO timestamp
  wake_time TEXT,                    -- NULL = currently sleeping
  quality INTEGER,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sleep_logs_date ON sleep_logs(date);

-- Vitamins / supplements ------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nutrients_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplement_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  supplement_id INTEGER NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
  taken_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, supplement_id)
);
CREATE INDEX IF NOT EXISTS idx_supplement_logs_date ON supplement_logs(date);

-- Agents ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content_json TEXT NOT NULL,        -- full Anthropic content blocks (JSON array or string)
  display_text TEXT NOT NULL DEFAULT '',
  tool_events_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conv ON agent_messages(conversation_id);

CREATE TABLE IF NOT EXISTS agent_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent);
`;

export function applySchema(): void {
  db.exec(SCHEMA_SQL);
}

// ---------------------------------------------------------------------------
// Date helpers (local calendar dates as YYYY-MM-DD)
// ---------------------------------------------------------------------------

export function todayStr(): string {
  return localDateStr(new Date());
}

export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** date - n days, as YYYY-MM-DD */
export function daysAgoStr(n: number, from?: string): string {
  const base = from ? new Date(`${from}T12:00:00`) : new Date();
  base.setDate(base.getDate() - n);
  return localDateStr(base);
}

/** Inclusive list of YYYY-MM-DD strings from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00`);
  const stop = new Date(`${end}T12:00:00`);
  while (d.getTime() <= stop.getTime()) {
    out.push(localDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
