# Architecture & segment implementation contract

Personal health app. Express + better-sqlite3 + Anthropic SDK backend (`server/`),
React + Vite + Recharts frontend (`client/`), shared types (`shared/`).

## Layout

```
shared/types.ts          All entity + API types. Extend if needed; never break existing.
shared/nutrients.ts      Tracked micronutrients + daily targets (NUTRIENTS, NUTRIENT_BY_KEY).
server/db.ts             SQLite schema (all tables exist), date helpers (todayStr, daysAgoStr, dateRange, isValidDateStr).
server/settingsStore.ts  getSettings()/saveSettings().
server/summaries.ts      Cross-segment aggregation: getNutritionSummary, getVitaminSummary,
                         getSleepForDate/History, getWorkoutDaySummary, estimateSteps,
                         row mappers (mapFood, mapSupplement, mapSleep, mapCardio), getWeightHistory, getWaterMlForDate.
server/score.ts          computeDailyScore(date), getScoreHistory(days).
server/anthropic.ts      getAnthropic(), hasApiKey(), AGENT_MODEL.
server/agents/framework.ts  AgentDef/ToolDef, runAgentTurn, consultAgent, listMemory,
                            memory tools auto-attached to every agent.
server/agents/registry.ts   Wires the 5 defs; injects consult_agent into master. DO NOT EDIT.
server/agents/defs/<name>.ts  One AgentDef per agent  ← segment-owned
server/routes/<name>.ts       Express routers          ← segment-owned
server/index.ts          Mounts routers at /api/<name>. DO NOT EDIT.
client/src/theme.css     Design tokens + all common CSS classes (card, btn, input, grid,
                         stat-tile, meter, chat, table.data, chip...). Use them; don't add CSS files.
client/src/viz/ChartKit.tsx  ChartCard, StatTile, TrendLine, HistoryBars, Meter, Legend, SERIES.
client/src/components/AgentChat.tsx  Shared chat panel: <AgentChat agent="..." title="..." onReply={refetch}/>.
client/src/api/http.ts   http.get/post/put/del + todayStr(). ApiError has .status/.message.
client/src/pages/<Segment>/index.tsx  Page component  ← segment-owned
client/src/App.tsx       Routing/nav. DO NOT EDIT.
```

## Ownership (a segment implementation may ONLY create/modify)

| Segment    | Files |
|---|---|
| workout    | `server/routes/workout.ts`, `server/agents/defs/workout.ts`, `client/src/pages/Workout/**`, `client/src/api/workout.ts` |
| nutrition  | `server/routes/nutrition.ts`, `server/agents/defs/nutrition.ts`, `client/src/pages/Nutrition/**`, `client/src/api/nutrition.ts` |
| sleep      | `server/routes/sleep.ts`, `server/agents/defs/sleep.ts`, `client/src/pages/Sleep/**`, `client/src/api/sleep.ts` |
| vitamins   | `server/routes/vitamins.ts`, `server/agents/defs/vitamins.ts`, `client/src/pages/Vitamins/**`, `client/src/api/vitamins.ts` |
| dashboard  | `server/routes/dashboard.ts`, `server/agents/defs/master.ts`, `client/src/pages/Dashboard/**`, `client/src/api/dashboard.ts` |

Everything else is shared infrastructure — read it, never write it. If a shared
helper is missing, implement the logic inside your own files instead.

## Conventions

- Dates are `YYYY-MM-DD` strings (server-local). Validate with `isValidDateStr`.
- DB columns are snake_case; shared types are camelCase — map explicitly (see
  `summaries.ts` mappers; reuse them where they exist).
- Routers: export `export const <name>Router = Router()`. Mounted at `/api/<name>`.
  JSON errors: `res.status(4xx).json({ error: "..." })`. Wrap DB writes that take
  user input in basic validation.
- Client pages fetch with the segment's `client/src/api/<name>.ts` module using
  `http.*`, type everything with `@shared/types` imports.
- Charts: ONLY via ChartKit components. Nutrient/goal progress uses `Meter`.
  Headline numbers use `StatTile`. ≥2 series ⇒ render `Legend`.
- Every page includes its `<AgentChat agent="<name>" ... onReply={reloadData} />`
  so tool-driven data changes show up immediately.

## Agent definitions (defs/<name>.ts)

Export `const <name>Agent: AgentDef` with:

- `persona`: a substantial system prompt (150-400 words): role, what the segment
  covers, how to use its tools (read before write; confirm destructive changes;
  after logging/creating data, briefly confirm what was recorded), how to use
  memory (save durable user facts: goals, preferences, constraints, injuries,
  patterns), tone (a genuinely helpful coach — concrete numbers, no filler).
  The framework injects saved memories and a live `<context>` data snapshot each
  turn; the persona should mention both exist.
- `tools`: ToolDef[] with real read AND write tools over the segment's tables so
  the agent can act ("log 2 eggs", "create a push/pull/legs plan", "mark my
  multivitamin taken"). Tool `run` returns a string (JSON.stringify structured
  results). Throw `Error` with a clear message on bad input — the framework
  converts it to an is_error tool_result.
- `buildContext()`: compact JSON snapshot of *today* + goals relevant to the
  segment (keep it under ~2KB; the model sees it every turn).

Memory tools (save/update/delete) are auto-attached by the framework — do not
redefine them. registry.ts gives master `consult_agent` — do not add it in the def.

## Per-segment product requirements

### workout
- Exercise library CRUD (name, muscle groups, equipment, form instructions, notes).
- Plans: CRUD; plan days with `dayOfWeek` (0=Sun..6=Sat) forming a weekly
  schedule; each day has ordered exercises (sets/reps/target weight/rest).
- Sessions: start/log a session (optionally from a plan day), record sets
  (reps/weight/RPE), complete it. Performance history per exercise (best set,
  volume over time — chart it).
- Cardio (walks & runs): log type (run/jog/walk/interval), distance, duration,
  intensity 1-10, optional free-text report; steps auto-estimated via
  `estimateSteps()` split run vs walked, with the option to hardcode total steps.
  History charts (distance/steps over time).
- Page: this week's schedule vs plans, today's scheduled workout, quick session
  logging UI, cardio log form + history, per-exercise progress chart, AgentChat.
- Agent tools (read+write): exercises, plans/plan-days/plan-exercises, sessions/sets,
  cardio (including updating a cardio session's report + reading reports for
  analysis), recent performance queries. The agent must be able to CREATE full
  plans with scheduled days and exercises in one flow.

### nutrition
- Food library CRUD (macros + optional micros map keyed by shared/nutrients keys).
- Food log per day/meal with servings; daily summary vs goals (calories + macros),
  meal breakdown; history charts (calories/macros over 30 days).
- Water: quick-add buttons (+250/+500/custom), daily total vs goal, 30-day chart.
- Weight: log per day, 90-day trend chart vs optional goal line.
- Page: today's summary (StatTiles + macro bars vs goals), meal log table,
  food picker/creator, water card, weight card, history charts, AgentChat.
- Agent tools: search/create foods (the agent fills macros AND micros from public
  knowledge for common items, source:'ai'), log/unlog foods, water, weight,
  read daily summary + history, set calorie/macro goals (writes settings via its
  own tool using settingsStore.saveSettings). Recommendation duties: goals from
  profile, remaining-macros-aware food suggestions.

### sleep
- One-tap "Going to bed" (creates open sleep log) and "I'm awake" (closes it);
  manual entry/edit for forgotten nights; quality 1-5 optional; notes.
- Attribution: sleep counts toward the wake date.
- Page: big bed/wake button (state-aware), last night StatTiles (duration vs
  target), 30-day duration chart with target reference line, recent log table
  with edit, AgentChat.
- Agent tools: log/edit sleep, read history/stats (avg duration, consistency,
  bedtime drift). Advises on schedule consistency.

### vitamins
- Daily coverage: `getVitaminSummary(date)` → Meter per nutrient (0-100%),
  food vs supplement split shown in detail text.
- Supplements: create with per-dose nutrient contents (form with rows keyed by
  shared/nutrients), toggle active; one-tap "taken today" toggles (unique per
  date), history.
- Page: today's coverage meters (sorted worst-first), supplement checklist for
  today, supplement manager, 30-day average coverage chart, AgentChat.
- Agent tools: read coverage (today + trends), manage supplements (create with
  nutrient contents, activate/deactivate), toggle taken, suggest foods for
  deficient nutrients (agent knowledge + can create foods is NOT allowed — food
  creation belongs to nutrition; instead it recommends and the user/nutrition
  agent logs).

### dashboard (master)
- Routes: `GET /api/dashboard/score?date=`, `GET /api/dashboard/history?days=30`
  (ScoreHistory), `GET /api/dashboard/overview` (today's per-segment key numbers
  for the tiles: score, calories vs goal, water, sleep hours, workout status,
  vitamin coverage avg, latest weight).
- Page: hero daily score + component StatTiles, 30-day score TrendLine with
  7/30-day averages, per-segment component mini-summaries, master AgentChat
  ("Health Coordinator") prominently placed.
- Master agent def: persona = coordinator that (1) monitors all segments daily,
  (2) makes combined recommendations, (3) uses consult_agent (injected by
  registry — see its description) to pull segment agents together on
  cross-cutting asks, (4) explains scores using the breakdown. Tools: read
  daily score + history + all four segment summaries (via summaries.ts + score.ts),
  read settings. Keep master's own tools read-only — writes happen via consulted
  segment agents' answers being relayed as recommendations.

## Definition of done (each segment)

- `npm run typecheck` clean for your files; no edits outside your ownership list.
- Routes validate input, return proper status codes, and match the client calls.
- Page renders with zero data (empty states) and with data; all charts via ChartKit.
- Agent def has ≥5 useful tools with accurate descriptions and working `run`s
  (test data paths by importing your functions — do NOT call the Anthropic API).
