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
  tracking_type TEXT NOT NULL DEFAULT 'weight_reps',
  intensity_rec TEXT NOT NULL DEFAULT '',
  goal_rec TEXT NOT NULL DEFAULT '',
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
  target_seconds INTEGER,
  target_distance_m REAL,
  target_count INTEGER,
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
  duration_seconds REAL,             -- seconds of timed work (e.g. planks)
  distance_m REAL,                   -- meters covered (distance-tracked work)
  count INTEGER,                     -- plain count (e.g. rounds) for count-tracked work
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cardio_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('run','jog','walk','interval','hiit','cycling','rowing','elliptical','other')),
  activity_label TEXT NOT NULL DEFAULT '',
  distance_km REAL NOT NULL DEFAULT 0,
  distance_estimated INTEGER NOT NULL DEFAULT 0,  -- 1 = distance auto-derived from steps
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
  goal TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  feel_where TEXT NOT NULL DEFAULT '',
  anim_kind TEXT NOT NULL DEFAULT 'none',
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
  calories REAL NOT NULL DEFAULT 0,
  protein_g REAL NOT NULL DEFAULT 0,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  sugar_g REAL NOT NULL DEFAULT 0,
  sodium_mg REAL NOT NULL DEFAULT 0,
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

/**
 * True when `table` already has a column named `column`. Uses the engine-neutral
 * prepare/get surface (pragma_table_info works identically on better-sqlite3 and
 * sql.js). Names are internal constants, never user input.
 */
function hasColumn(table: string, column: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM pragma_table_info('${table}') WHERE name = '${column}'`,
    )
    .get() as { c: number };
  return row.c > 0;
}

/** Guarded ALTER TABLE ADD COLUMN — a silent no-op if the column already exists. */
function addColumn(table: string, column: string, ddl: string): void {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function applySchema(): void {
  db.exec(SCHEMA_SQL);
  // In-place migrations for databases created before a column existed. Each is
  // guarded so re-running is a silent no-op on already-upgraded databases, and
  // uses only the engine-neutral prepare/get + exec surface (works identically
  // with better-sqlite3 and sql.js). NOT NULL columns always carry a DEFAULT so
  // ADD COLUMN succeeds against existing rows.

  // Workout — timed/distance/count-tracked sets + richer exercise metadata.
  addColumn("session_sets", "duration_seconds", "duration_seconds REAL");
  addColumn("session_sets", "distance_m", "distance_m REAL");
  addColumn("session_sets", "count", "count INTEGER");
  addColumn("exercises", "tracking_type", "tracking_type TEXT NOT NULL DEFAULT 'weight_reps'");
  addColumn("exercises", "intensity_rec", "intensity_rec TEXT NOT NULL DEFAULT ''");
  addColumn("exercises", "goal_rec", "goal_rec TEXT NOT NULL DEFAULT ''");
  addColumn("plan_day_exercises", "target_seconds", "target_seconds INTEGER");
  addColumn("plan_day_exercises", "target_distance_m", "target_distance_m REAL");
  addColumn("plan_day_exercises", "target_count", "target_count INTEGER");

  // Vitamins — supplements now carry a per-dose macro contribution.
  addColumn("supplements", "calories", "calories REAL NOT NULL DEFAULT 0");
  addColumn("supplements", "protein_g", "protein_g REAL NOT NULL DEFAULT 0");
  addColumn("supplements", "carbs_g", "carbs_g REAL NOT NULL DEFAULT 0");
  addColumn("supplements", "fat_g", "fat_g REAL NOT NULL DEFAULT 0");
  addColumn("supplements", "sugar_g", "sugar_g REAL NOT NULL DEFAULT 0");
  addColumn("supplements", "sodium_mg", "sodium_mg REAL NOT NULL DEFAULT 0");

  // Mobility — richer stretch/pose metadata.
  addColumn("stretches", "goal", "goal TEXT NOT NULL DEFAULT ''");
  addColumn("stretches", "focus", "focus TEXT NOT NULL DEFAULT ''");
  addColumn("stretches", "feel_where", "feel_where TEXT NOT NULL DEFAULT ''");
  addColumn("stretches", "anim_kind", "anim_kind TEXT NOT NULL DEFAULT 'none'");

  // Cardio — the type CHECK constraint must be relaxed to the 9 activity types
  // and an activity_label added. A CHECK cannot be altered in place, so existing
  // databases are rebuilt (create-new / copy / drop / rename) inside one
  // transaction. Guard: only rebuild when the stored table SQL predates 'hiit'.
  // Fresh databases already get the new definition from SCHEMA_SQL above, so
  // their SQL contains 'hiit' and this is skipped. Nothing references
  // cardio_sessions, so dropping it is safe.
  const cardioSql =
    (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='cardio_sessions'",
        )
        .get() as { sql: string } | undefined
    )?.sql ?? "";
  if (cardioSql && !cardioSql.includes("hiit")) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE cardio_sessions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('run','jog','walk','interval','hiit','cycling','rowing','elliptical','other')),
          activity_label TEXT NOT NULL DEFAULT '',
          distance_km REAL NOT NULL DEFAULT 0,
          duration_minutes REAL NOT NULL DEFAULT 0,
          intensity INTEGER NOT NULL DEFAULT 5,
          steps INTEGER,
          estimated_steps_run INTEGER,
          estimated_steps_walked INTEGER,
          report TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO cardio_sessions_new
          (id, date, type, distance_km, duration_minutes, intensity,
           steps, estimated_steps_run, estimated_steps_walked, report, notes)
          SELECT id, date, type, distance_km, duration_minutes, intensity,
                 steps, estimated_steps_run, estimated_steps_walked, report, notes
          FROM cardio_sessions;
        DROP TABLE cardio_sessions;
        ALTER TABLE cardio_sessions_new RENAME TO cardio_sessions;
      `);
    })();
  }
  // Cardio — marks whether distance_km was auto-derived from steps vs. entered.
  // Added AFTER the rebuild above so it lands on the final table in every path
  // (fresh SCHEMA_SQL already has it → no-op; rebuilt/legacy tables get it here).
  addColumn(
    "cardio_sessions",
    "distance_estimated",
    "distance_estimated INTEGER NOT NULL DEFAULT 0",
  );
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
