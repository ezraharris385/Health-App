/**
 * Mobility page: stretching / yoga / posture. Today's tiles, quick session
 * logging, 1-10 quick-rating of user-defined metrics with per-metric trend
 * charts, a 30-day minutes chart, the routine manager (nested item editor
 * from the stretch bank), the stretch bank itself, the recent-sessions table,
 * and the Mobility Coach chat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MobilityAssessment,
  MobilityDaySummary,
  MobilityKind,
  MobilityMetric,
  MobilitySession,
  Stretch,
  StretchCategory,
} from "@shared/types";
import {
  mobilityApi,
  type MobilityHistoryPoint,
  type RoutineItemInput,
  type RoutineWithItems,
} from "../../api/mobility";
import { AgentChat } from "../../components/AgentChat";
import { ChartCard, HistoryBars, SERIES, StatTile, TrendLine } from "../../viz/ChartKit";

const HISTORY_DAYS = 30;
const TREND_DAYS = 180;

const KINDS: MobilityKind[] = ["stretch", "yoga", "posture", "mixed"];
const CATEGORIES: StretchCategory[] = ["stretch", "yoga", "posture"];
const FEEL_LABELS = ["1 — rough", "2 — stiff", "3 — okay", "4 — good", "5 — great"];

type MetricLatest = MobilityDaySummary["metricsLatest"][number];

const dirLabel = (d: MobilityMetric["direction"]) =>
  d === "higher_better" ? "higher is better" : "lower is better";

const truncate = (s: string, max = 64) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export default function MobilityPage() {
  const [summary, setSummary] = useState<MobilityDaySummary | null>(null);
  const [stretches, setStretches] = useState<Stretch[]>([]);
  const [routines, setRoutines] = useState<RoutineWithItems[]>([]);
  const [sessions, setSessions] = useState<MobilitySession[]>([]);
  const [metrics, setMetrics] = useState<MobilityMetric[]>([]);
  const [assessments, setAssessments] = useState<MobilityAssessment[]>([]);
  const [history, setHistory] = useState<MobilityHistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [sum, bank, rts, ses, mets, asmts, hist] = await Promise.all([
        mobilityApi.summary(),
        mobilityApi.stretches(),
        mobilityApi.routines(true),
        mobilityApi.sessions(HISTORY_DAYS),
        mobilityApi.metrics(),
        mobilityApi.assessments({ days: TREND_DAYS }),
        mobilityApi.history(HISTORY_DAYS),
      ]);
      setSummary(sum);
      setStretches(bank);
      setRoutines(rts);
      setSessions(ses);
      setMetrics(mets);
      setAssessments(asmts);
      setHistory(hist);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mobility data");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const activeRoutines = useMemo(() => routines.filter((r) => r.archived === 0), [routines]);
  const activeMetrics = useMemo(() => metrics.filter((m) => m.active === 1), [metrics]);
  const latestByMetric = useMemo(
    () => new Map((summary?.metricsLatest ?? []).map((m) => [m.metricId, m])),
    [summary],
  );
  // /assessments returns date ASC, id ASC — already chart-ready once grouped.
  const assessmentsByMetric = useMemo(() => {
    const map = new Map<number, MobilityAssessment[]>();
    for (const a of assessments) {
      const list = map.get(a.metricId);
      if (list) list.push(a);
      else map.set(a.metricId, [a]);
    }
    return map;
  }, [assessments]);
  const trendMetrics = useMemo(
    () => activeMetrics.filter((m) => (assessmentsByMetric.get(m.id)?.length ?? 0) >= 2),
    [activeMetrics, assessmentsByMetric],
  );
  // Most recent rating per metric (window is date ASC, id ASC — last one wins),
  // so a fat-fingered rating can be undone from the metrics card.
  const lastAssessmentByMetric = useMemo(() => {
    const map = new Map<number, MobilityAssessment>();
    for (const a of assessments) map.set(a.metricId, a);
    return map;
  }, [assessments]);
  const historyData = useMemo(
    () => history.map((p) => ({ date: p.date.slice(5), minutes: p.totalMinutes })),
    [history],
  );

  const byKindText = useMemo(() => {
    if (!summary) return undefined;
    const parts = (Object.entries(summary.byKind) as [MobilityKind, number][]).map(
      ([k, n]) => `${n} ${k}`,
    );
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }, [summary]);

  if (!loaded) return <p className="empty">Loading…</p>;

  return (
    <div>
      <h1 className="page-title">Mobility</h1>
      <p className="page-sub">
        Stretching, yoga, and posture work — log sessions, build routines, and track how your
        body feels over time.
      </p>
      {error && <p className="error-text">{error}</p>}

      <div className="grid cols-3">
        <StatTile
          label="Sessions today"
          value={summary?.sessions.length ?? 0}
          delta={byKindText}
        />
        <StatTile label="Minutes today" value={summary?.totalMinutes ?? 0} />
        <StatTile
          label="Metrics tracked"
          value={summary?.metricsLatest.length ?? 0}
          delta="active metrics"
        />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <SessionLogCard routines={activeRoutines} onChange={loadAll} />
        <MetricsCard
          metrics={metrics}
          latestByMetric={latestByMetric}
          lastAssessmentByMetric={lastAssessmentByMetric}
          onChange={loadAll}
        />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <ChartCard
          title="Metric trends"
          sub={`Assessments over the last ${TREND_DAYS} days · scored 1-10`}
        >
          {trendMetrics.length === 0 ? (
            <p className="empty">
              Rate a metric a couple of times and its trend shows up here.
            </p>
          ) : (
            <div className="stack" style={{ gap: 16 }}>
              {trendMetrics.map((m, i) => (
                <div key={m.id}>
                  <div className="row between">
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                    <span className="chip">{dirLabel(m.direction)}</span>
                  </div>
                  <TrendLine
                    data={(assessmentsByMetric.get(m.id) ?? []).map((a) => ({
                      date: a.date.slice(5),
                      score: a.score,
                    }))}
                    x="date"
                    series={[{ key: "score", name: m.name, color: SERIES[i % SERIES.length] }]}
                    yDomain={[1, 10]}
                    height={150}
                  />
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        <ChartCard title={`Activity — last ${HISTORY_DAYS} days`} sub="Mobility minutes per day">
          {sessions.length === 0 && (
            <p className="empty" style={{ padding: 0 }}>
              Nothing logged yet — your daily minutes will chart here.
            </p>
          )}
          <HistoryBars
            data={historyData}
            x="date"
            bars={[{ key: "minutes", name: "Minutes" }]}
            unit="min"
            height={220}
          />
        </ChartCard>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <RoutinesCard routines={routines} stretches={stretches} onChange={loadAll} />
        <StretchBankCard stretches={stretches} onChange={loadAll} />
      </div>

      <div style={{ marginTop: 14 }}>
        <SessionsTableCard sessions={sessions} routines={routines} onChange={loadAll} />
      </div>

      <div style={{ marginTop: 14 }}>
        <AgentChat
          agent="mobility"
          title="Mobility Coach"
          placeholder="Ask for a routine ('build me a 10-minute desk posture reset'), log a session, or report how tight your hamstrings feel."
          onReply={loadAll}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log a session
// ---------------------------------------------------------------------------

function SessionLogCard(props: { routines: RoutineWithItems[]; onChange: () => void }) {
  const [kind, setKind] = useState<MobilityKind>("stretch");
  const [routineId, setRoutineId] = useState("");
  const [duration, setDuration] = useState("");
  const [feel, setFeel] = useState("");
  const [report, setReport] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A picked routine can vanish from the list (deleted or archived elsewhere
  // on the page); drop the stale id so the blank-looking picker never submits it.
  useEffect(() => {
    if (routineId !== "" && !props.routines.some((r) => String(r.id) === routineId)) {
      setRoutineId("");
    }
  }, [props.routines, routineId]);

  async function submit() {
    const minutes = Number(duration);
    if (duration.trim() === "" || !Number.isFinite(minutes) || minutes <= 0) {
      setError("Enter how many minutes the session took");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mobilityApi.createSession({
        kind,
        routineId: routineId === "" ? null : Number(routineId),
        durationMinutes: minutes,
        feel: feel === "" ? null : Number(feel),
        report: report.trim(),
        notes: notes.trim(),
      });
      setRoutineId("");
      setDuration("");
      setFeel("");
      setReport("");
      setNotes("");
      props.onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Log a session</h3>
      <div className="stack">
        <div className="row wrap">
          <label className="field" style={{ flex: 1, minWidth: 110 }}>
            Kind
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as MobilityKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            Routine (optional)
            <select
              className="input"
              value={routineId}
              onChange={(e) => setRoutineId(e.target.value)}
            >
              <option value="">Freestyle</option>
              {props.routines.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row wrap">
          <label className="field" style={{ width: 110 }}>
            Minutes
            <input
              className="input"
              type="number"
              min={1}
              max={600}
              placeholder="15"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 130 }}>
            Feel (optional)
            <select className="input" value={feel} onChange={(e) => setFeel(e.target.value)}>
              <option value="">—</option>
              {FEEL_LABELS.map((l, i) => (
                <option key={l} value={i + 1}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          How did it go?
          <textarea
            className="input"
            rows={3}
            placeholder="e.g. hips were tight at first, hamstrings loosened up by the end — the coach reads this"
            value={report}
            onChange={(e) => setReport(e.target.value)}
          />
        </label>
        <label className="field">
          Notes
          <input
            className="input"
            placeholder="optional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={submit}>
            Log session
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate your metrics
// ---------------------------------------------------------------------------

function MetricsCard(props: {
  metrics: MobilityMetric[];
  latestByMetric: Map<number, MetricLatest>;
  lastAssessmentByMetric: Map<number, MobilityAssessment>;
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<MobilityMetric["direction"]>("higher_better");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = props.metrics.filter((m) => m.active === 1);
  const inactive = props.metrics.filter((m) => m.active === 0);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      props.onChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addMetric() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Metric name is required");
      return;
    }
    const ok = await run(() =>
      mobilityApi.createMetric({ name: trimmed, direction, description: description.trim() }),
    );
    if (ok) {
      setName("");
      setDescription("");
      setDirection("higher_better");
    }
  }

  return (
    <div className="card">
      <h3>Rate your metrics</h3>
      <div className="card-sub">Quick 1-10 self-ratings — logged for today</div>

      {active.length === 0 && (
        <p className="empty">
          No metrics yet. Track things like “Hamstring flexibility” or “Morning back stiffness”
          and rate them 1-10 over time.
        </p>
      )}

      {active.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          {active.map((m) => {
            const latest = props.latestByMetric.get(m.id);
            const last = props.lastAssessmentByMetric.get(m.id);
            return (
              <div key={m.id} className="row between wrap">
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>{m.name}</span>
                    <span className="chip">{dirLabel(m.direction)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {latest?.latestScore != null
                      ? `latest ${latest.latestScore}/10 on ${latest.latestDate}`
                      : "not rated yet"}
                    {m.description ? ` · ${m.description}` : ""}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <select
                    className="input"
                    style={{ width: 96 }}
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v) run(() => mobilityApi.createAssessment({ metricId: m.id, score: Number(v) }));
                    }}
                  >
                    <option value="">Rate…</option>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {last && (
                    <button
                      className="btn small"
                      disabled={busy}
                      title="Delete the most recent rating — e.g. to fix a mis-click"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Undo the ${last.score}/10 rating of "${m.name}" from ${last.date}?`,
                          )
                        ) {
                          run(() => mobilityApi.deleteAssessment(last.id));
                        }
                      }}
                    >
                      Undo
                    </button>
                  )}
                  <button
                    className="btn small"
                    disabled={busy}
                    title="Deactivated metrics keep their history and can be reactivated"
                    onClick={() => run(() => mobilityApi.updateMetric(m.id, { active: 0 }))}
                  >
                    Deactivate
                  </button>
                  <button
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${m.name}" and all its ratings? Deactivating keeps history.`,
                        )
                      ) {
                        run(() => mobilityApi.deleteMetric(m.id));
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {inactive.length > 0 && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>Inactive</div>
          {inactive.map((m) => (
            <div key={m.id} className="row between wrap" style={{ opacity: 0.6 }}>
              <span>{m.name}</span>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => run(() => mobilityApi.updateMetric(m.id, { active: 1 }))}
                >
                  Activate
                </button>
                <button
                  className="btn small danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${m.name}" and all its ratings?`)) {
                      run(() => mobilityApi.deleteMetric(m.id));
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="stack" style={{ gap: 8, marginTop: 14 }}>
        <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 500 }}>Add a metric</div>
        <div className="row wrap">
          <input
            className="input"
            style={{ flex: 2, minWidth: 140 }}
            placeholder="e.g. Hamstring flexibility"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="input"
            style={{ width: 170 }}
            value={direction}
            onChange={(e) => setDirection(e.target.value as MobilityMetric["direction"])}
          >
            <option value="higher_better">Higher is better</option>
            <option value="lower_better">Lower is better</option>
          </select>
        </div>
        <div className="row wrap">
          <input
            className="input"
            style={{ flex: 1, minWidth: 140 }}
            placeholder="Description (e.g. how far past my toes I reach)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button className="btn small primary" disabled={busy} onClick={addMetric}>
            Add
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Routines (nested item editor over the stretch bank)
// ---------------------------------------------------------------------------

interface RoutineItemRow {
  key: number;
  stretchId: number;
  holdSeconds: string;
  reps: string;
  perSide: boolean;
  notes: string;
}

interface RoutineFormState {
  id: number | null; // null = creating
  name: string;
  focus: string;
  description: string;
  items: RoutineItemRow[];
}

function itemDose(it: { holdSeconds: number | null; reps: number | null; perSide: 0 | 1 }): string {
  const parts: string[] = [];
  if (it.holdSeconds != null) parts.push(`${it.holdSeconds}s`);
  if (it.reps != null) parts.push(`×${it.reps}`);
  if (it.perSide === 1) parts.push("each side");
  return parts.join(" · ");
}

function RoutinesCard(props: {
  routines: RoutineWithItems[];
  stretches: Stretch[];
  onChange: () => void;
}) {
  const [form, setForm] = useState<RoutineFormState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pickId, setPickId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1);

  const stretchById = useMemo(
    () => new Map(props.stretches.map((s) => [s.id, s])),
    [props.stretches],
  );
  const shown = showArchived ? props.routines : props.routines.filter((r) => r.archived === 0);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      props.onChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function emptyForm(): RoutineFormState {
    return { id: null, name: "", focus: "", description: "", items: [] };
  }

  function formFromRoutine(r: RoutineWithItems): RoutineFormState {
    return {
      id: r.id,
      name: r.name,
      focus: r.focus,
      description: r.description,
      items: r.items.map((it) => ({
        key: nextKey.current++,
        stretchId: it.stretchId,
        holdSeconds: it.holdSeconds != null ? String(it.holdSeconds) : "",
        reps: it.reps != null ? String(it.reps) : "",
        perSide: it.perSide === 1,
        notes: it.notes,
      })),
    };
  }

  function addRow() {
    if (!form || pickId === "") return;
    const stretch = stretchById.get(Number(pickId));
    setForm({
      ...form,
      items: [
        ...form.items,
        {
          key: nextKey.current++,
          stretchId: Number(pickId),
          holdSeconds: stretch?.defaultHoldSeconds != null ? String(stretch.defaultHoldSeconds) : "",
          reps: "",
          perSide: false,
          notes: "",
        },
      ],
    });
    setPickId("");
  }

  function updateRow(index: number, patch: Partial<RoutineItemRow>) {
    if (!form) return;
    const items = form.items.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setForm({ ...form, items });
  }

  function moveRow(index: number, dir: -1 | 1) {
    if (!form) return;
    const j = index + dir;
    if (j < 0 || j >= form.items.length) return;
    const items = [...form.items];
    [items[index], items[j]] = [items[j], items[index]];
    setForm({ ...form, items });
  }

  function removeRow(index: number) {
    if (!form) return;
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) });
  }

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setError("Routine name is required");
      return;
    }
    const items: RoutineItemInput[] = [];
    for (const [i, row] of form.items.entries()) {
      const holdSeconds = row.holdSeconds.trim() === "" ? null : Number(row.holdSeconds);
      const reps = row.reps.trim() === "" ? null : Number(row.reps);
      if (holdSeconds !== null && (!Number.isInteger(holdSeconds) || holdSeconds <= 0)) {
        setError(`Item ${i + 1}: hold seconds must be a positive whole number`);
        return;
      }
      if (reps !== null && (!Number.isInteger(reps) || reps <= 0)) {
        setError(`Item ${i + 1}: reps must be a positive whole number`);
        return;
      }
      items.push({
        stretchId: row.stretchId,
        holdSeconds,
        reps,
        perSide: row.perSide,
        notes: row.notes.trim(),
      });
    }
    const body = {
      name,
      focus: form.focus.trim(),
      description: form.description.trim(),
      items,
    };
    const ok = await run(() =>
      form.id === null ? mobilityApi.createRoutine(body) : mobilityApi.updateRoutine(form.id, body),
    );
    if (ok) setForm(null);
  }

  return (
    <div className="card">
      <div className="row between">
        <h3>Routines</h3>
        {!form && (
          <button
            className="btn small primary"
            onClick={() => {
              setError(null);
              setForm(emptyForm());
            }}
          >
            New routine
          </button>
        )}
      </div>

      {shown.length === 0 && !form && (
        <p className="empty">
          No routines yet. Build one from your stretch bank — or ask the Mobility Coach to put
          one together for you.
        </p>
      )}

      {shown.length > 0 && (
        <div className="stack">
          {shown.map((r) => (
            <div
              key={r.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                opacity: r.archived === 1 ? 0.55 : undefined,
              }}
            >
              <div className="row between wrap">
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>{r.name}</span>
                    {r.focus && <span className="chip">{r.focus}</span>}
                    {r.archived === 1 && <span className="chip">archived</span>}
                  </div>
                  {r.description && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.description}</div>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setForm(formFromRoutine(r));
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn small"
                    disabled={busy}
                    title="Archived routines drop out of the session-log picker but keep history"
                    onClick={() =>
                      run(() => mobilityApi.updateRoutine(r.id, { archived: r.archived === 1 ? 0 : 1 }))
                    }
                  >
                    {r.archived === 1 ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete routine "${r.name}"? Archiving keeps it for past sessions.`,
                        )
                      ) {
                        run(() => mobilityApi.deleteRoutine(r.id));
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                {r.items.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    No stretches in this routine yet — edit it to add some.
                  </span>
                ) : (
                  r.items.map((it) => (
                    <span key={it.id} className="chip" title={it.notes || undefined}>
                      {it.stretchName}
                      {itemDose(it) && ` · ${itemDose(it)}`}
                      {it.notes && " *"}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {props.routines.some((r) => r.archived === 1) && (
        <label className="row" style={{ gap: 6, fontSize: 12, color: "var(--ink-2)", marginTop: 10 }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      )}

      {form && (
        <div className="stack" style={{ marginTop: 14 }}>
          <strong>{form.id === null ? "New routine" : `Edit: ${form.name || "routine"}`}</strong>
          <div className="row wrap">
            <label className="field" style={{ flex: 2, minWidth: 140 }}>
              Name
              <input
                className="input"
                placeholder="e.g. Morning hips"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Focus
              <input
                className="input"
                placeholder="e.g. hip mobility"
                value={form.focus}
                onChange={(e) => setForm({ ...form, focus: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            Description
            <input
              className="input"
              placeholder="optional"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>

          <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 500 }}>
            Stretches, in order
          </div>
          {form.items.length === 0 && (
            <p className="empty" style={{ padding: 0 }}>
              No stretches yet — pick from the bank below.
            </p>
          )}
          {form.items.map((row, i) => (
            <div key={row.key} className="row wrap" style={{ gap: 6 }}>
              <span style={{ width: 18, fontSize: 12, color: "var(--muted)" }}>{i + 1}.</span>
              <span style={{ flex: 2, minWidth: 100, fontWeight: 600, fontSize: 13 }}>
                {stretchById.get(row.stretchId)?.name ?? "stretch"}
              </span>
              <input
                className="input"
                style={{ width: 80 }}
                type="number"
                min={1}
                placeholder="hold s"
                title="Hold seconds"
                value={row.holdSeconds}
                onChange={(e) => updateRow(i, { holdSeconds: e.target.value })}
              />
              <input
                className="input"
                style={{ width: 70 }}
                type="number"
                min={1}
                placeholder="reps"
                title="Reps"
                value={row.reps}
                onChange={(e) => updateRow(i, { reps: e.target.value })}
              />
              <label className="row" style={{ gap: 4, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={row.perSide}
                  onChange={(e) => updateRow(i, { perSide: e.target.checked })}
                />
                per side
              </label>
              <input
                className="input"
                style={{ flex: 1, minWidth: 110 }}
                placeholder="note / cue"
                title="Item note, e.g. 'keep back flat' or 'skip if knee hurts'"
                value={row.notes}
                onChange={(e) => updateRow(i, { notes: e.target.value })}
              />
              <button className="btn small" disabled={i === 0} onClick={() => moveRow(i, -1)}>
                ↑
              </button>
              <button
                className="btn small"
                disabled={i === form.items.length - 1}
                onClick={() => moveRow(i, 1)}
              >
                ↓
              </button>
              <button className="btn small danger" onClick={() => removeRow(i)}>
                ×
              </button>
            </div>
          ))}
          <div className="row wrap">
            <select
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
            >
              <option value="">Add a stretch…</option>
              {props.stretches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="btn small" disabled={pickId === ""} onClick={addRow}>
              Add
            </button>
          </div>
          {props.stretches.length === 0 && (
            <p className="empty" style={{ padding: 0 }}>
              The stretch bank is empty — add stretches in the bank card first.
            </p>
          )}

          <div className="row">
            <button className="btn primary" disabled={busy} onClick={save}>
              {form.id === null ? "Create routine" : "Save changes"}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setForm(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stretch bank
// ---------------------------------------------------------------------------

interface StretchFormState {
  id: number | null; // null = creating
  name: string;
  category: StretchCategory;
  targetAreas: string;
  instructions: string;
  defaultHoldSeconds: string;
  notes: string;
}

function StretchBankCard(props: { stretches: Stretch[]; onChange: () => void }) {
  const [form, setForm] = useState<StretchFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      props.onChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function emptyForm(): StretchFormState {
    return {
      id: null,
      name: "",
      category: "stretch",
      targetAreas: "",
      instructions: "",
      defaultHoldSeconds: "",
      notes: "",
    };
  }

  function formFromStretch(s: Stretch): StretchFormState {
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      targetAreas: s.targetAreas,
      instructions: s.instructions,
      defaultHoldSeconds: s.defaultHoldSeconds != null ? String(s.defaultHoldSeconds) : "",
      notes: s.notes,
    };
  }

  async function save() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    const hold = form.defaultHoldSeconds.trim() === "" ? null : Number(form.defaultHoldSeconds);
    if (hold !== null && (!Number.isInteger(hold) || hold <= 0)) {
      setError("Default hold must be a positive whole number of seconds");
      return;
    }
    const body = {
      name,
      category: form.category,
      targetAreas: form.targetAreas.trim(),
      instructions: form.instructions.trim(),
      defaultHoldSeconds: hold,
      notes: form.notes.trim(),
    };
    const ok = await run(() =>
      form.id === null ? mobilityApi.createStretch(body) : mobilityApi.updateStretch(form.id, body),
    );
    if (ok) setForm(null);
  }

  return (
    <div className="card">
      <div className="row between">
        <h3>Stretch bank</h3>
        {!form && (
          <button
            className="btn small primary"
            onClick={() => {
              setError(null);
              setForm(emptyForm());
            }}
          >
            New stretch
          </button>
        )}
      </div>

      {props.stretches.length === 0 && !form && (
        <p className="empty">
          No stretches yet. Add the moves you actually do — hamstring stretch, downward dog,
          chin tucks… — then build routines from them.
        </p>
      )}

      {props.stretches.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Targets</th>
              <th>Hold</th>
              <th style={{ width: 130 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.stretches.map((s) => (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 600 }} title={s.instructions || undefined}>
                    {s.name}
                  </div>
                  {s.notes && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{truncate(s.notes, 40)}</div>
                  )}
                </td>
                <td>
                  <span className="chip">{s.category}</span>
                </td>
                <td style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.targetAreas || "—"}</td>
                <td>{s.defaultHoldSeconds != null ? `${s.defaultHoldSeconds}s` : "—"}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setForm(formFromStretch(s));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn small danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete "${s.name}"? Routines using it will drop it from their items.`,
                          )
                        ) {
                          run(() => mobilityApi.deleteStretch(s.id));
                        }
                      }}
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <div className="stack" style={{ marginTop: 14 }}>
          <strong>{form.id === null ? "New stretch" : `Edit: ${form.name || "stretch"}`}</strong>
          <div className="row wrap">
            <label className="field" style={{ flex: 2, minWidth: 140 }}>
              Name
              <input
                className="input"
                placeholder="e.g. Couch stretch"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field" style={{ width: 130 }}>
              Category
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as StretchCategory })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row wrap">
            <label className="field" style={{ flex: 2, minWidth: 140 }}>
              Target areas
              <input
                className="input"
                placeholder="e.g. hip flexors, quads"
                value={form.targetAreas}
                onChange={(e) => setForm({ ...form, targetAreas: e.target.value })}
              />
            </label>
            <label className="field" style={{ width: 130 }}>
              Default hold (s)
              <input
                className="input"
                type="number"
                min={1}
                placeholder="30"
                value={form.defaultHoldSeconds}
                onChange={(e) => setForm({ ...form, defaultHoldSeconds: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            Instructions (form cues)
            <textarea
              className="input"
              rows={2}
              placeholder="e.g. rear knee against the wall, squeeze the glute, ribs down"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
          </label>
          <label className="field">
            Notes
            <input
              className="input"
              placeholder="optional"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={save}>
              {form.id === null ? "Create stretch" : "Save changes"}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setForm(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent sessions
// ---------------------------------------------------------------------------

interface SessionEditState {
  id: number;
  date: string;
  kind: MobilityKind;
  routineId: string;
  duration: string;
  feel: string;
  report: string;
  notes: string;
}

function SessionsTableCard(props: {
  sessions: MobilitySession[];
  routines: RoutineWithItems[];
  onChange: () => void;
}) {
  const [edit, setEdit] = useState<SessionEditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active routines are pickable; the session's current routine stays pickable
  // even when archived, so editing never silently detaches it.
  const pickableRoutines = props.routines.filter(
    (r) => r.archived === 0 || (edit !== null && String(r.id) === edit.routineId),
  );

  function loadForEdit(s: MobilitySession) {
    setError(null);
    setEdit({
      id: s.id,
      date: s.date,
      kind: s.kind,
      routineId: s.routineId != null ? String(s.routineId) : "",
      duration: String(s.durationMinutes),
      feel: s.feel != null ? String(s.feel) : "",
      report: s.report,
      notes: s.notes,
    });
  }

  async function save() {
    if (!edit) return;
    const minutes = Number(edit.duration);
    if (edit.duration.trim() === "" || !Number.isFinite(minutes) || minutes <= 0) {
      setError("Enter how many minutes the session took");
      return;
    }
    if (edit.date === "") {
      setError("Date is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mobilityApi.updateSession(edit.id, {
        date: edit.date,
        kind: edit.kind,
        routineId: edit.routineId === "" ? null : Number(edit.routineId),
        durationMinutes: minutes,
        feel: edit.feel === "" ? null : Number(edit.feel),
        report: edit.report.trim(),
        notes: edit.notes.trim(),
      });
      setEdit(null);
      props.onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update session");
    } finally {
      setBusy(false);
    }
  }

  async function del(s: MobilitySession) {
    if (!window.confirm(`Delete the ${s.durationMinutes}-minute ${s.kind} session on ${s.date}?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mobilityApi.deleteSession(s.id);
      if (edit?.id === s.id) setEdit(null);
      props.onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Recent sessions</h3>
      <div className="card-sub">Last {HISTORY_DAYS} days · newest first</div>
      {props.sessions.length === 0 ? (
        <p className="empty">No sessions yet — log your first one above.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Kind</th>
              <th>Routine</th>
              <th>Min</th>
              <th>Feel</th>
              <th>Report</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.date}</td>
                <td>
                  <span className="chip">{s.kind}</span>
                </td>
                <td>{s.routineName ?? "—"}</td>
                <td>{s.durationMinutes}</td>
                <td>{s.feel != null ? `${s.feel}/5` : "—"}</td>
                <td style={{ fontSize: 12, color: "var(--ink-2)" }} title={s.report || undefined}>
                  {s.report ? truncate(s.report) : "—"}
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn small" disabled={busy} onClick={() => loadForEdit(s)}>
                      Edit
                    </button>
                    <button className="btn small danger" disabled={busy} onClick={() => del(s)}>
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {edit && (
        <div className="stack" style={{ marginTop: 14 }}>
          <strong>Edit session #{edit.id}</strong>
          <div className="row wrap">
            <label className="field" style={{ width: 140 }}>
              Date
              <input
                className="input"
                type="date"
                value={edit.date}
                onChange={(e) => setEdit({ ...edit, date: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 110 }}>
              Kind
              <select
                className="input"
                value={edit.kind}
                onChange={(e) => setEdit({ ...edit, kind: e.target.value as MobilityKind })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              Routine
              <select
                className="input"
                value={edit.routineId}
                onChange={(e) => setEdit({ ...edit, routineId: e.target.value })}
              >
                <option value="">Freestyle</option>
                {pickableRoutines.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.archived === 1 ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row wrap">
            <label className="field" style={{ width: 110 }}>
              Minutes
              <input
                className="input"
                type="number"
                min={1}
                max={600}
                value={edit.duration}
                onChange={(e) => setEdit({ ...edit, duration: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 130 }}>
              Feel
              <select
                className="input"
                value={edit.feel}
                onChange={(e) => setEdit({ ...edit, feel: e.target.value })}
              >
                <option value="">—</option>
                {FEEL_LABELS.map((l, i) => (
                  <option key={l} value={i + 1}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            How did it go?
            <textarea
              className="input"
              rows={3}
              placeholder="e.g. hips were tight at first, hamstrings loosened up by the end — the coach reads this"
              value={edit.report}
              onChange={(e) => setEdit({ ...edit, report: e.target.value })}
            />
          </label>
          <label className="field">
            Notes
            <input
              className="input"
              placeholder="optional"
              value={edit.notes}
              onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
            />
          </label>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={save}>
              Save changes
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setEdit(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
