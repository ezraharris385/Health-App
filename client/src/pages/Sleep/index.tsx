import { useCallback, useEffect, useMemo, useState } from "react";
import type { SleepLog } from "@shared/types";
import { sleepApi, type SleepHistoryResponse, type SleepStats } from "../../api/sleep";
import { ApiError } from "../../api/http";
import { AgentChat } from "../../components/AgentChat";
import { ChartCard, HistoryBars, StatTile } from "../../viz/ChartKit";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtHours(h: number | null | undefined): string {
  if (h == null) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (mm === 60) return `${hh + 1}h 00m`;
  return `${hh}h ${String(mm).padStart(2, "0")}m`;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "23:24" (server HH:MM) -> locale clock like "11:24 PM" */
function fmtHHMM(hhmm: string | null | undefined): string {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  // Non-breaking space before AM/PM: half-width stat tiles otherwise wrap the
  // value to "10:34" / "PM".
  return d
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, "\u00a0");
}

function fmtDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function nightsLabel(n: number): string {
  return `${n} night${n === 1 ? "" : "s"}`;
}

/** ISO timestamp -> value for <input type="datetime-local"> */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface FormState {
  bedTime: string; // datetime-local value
  wakeTime: string;
  quality: string; // "" | "1".."5"
  notes: string;
}

function defaultFormState(): FormState {
  const bed = new Date();
  bed.setDate(bed.getDate() - 1);
  bed.setHours(23, 0, 0, 0);
  const wake = new Date();
  wake.setHours(7, 0, 0, 0);
  return {
    bedTime: isoToLocalInput(bed.toISOString()),
    wakeTime: isoToLocalInput(wake.toISOString()),
    quality: "",
    notes: "",
  };
}

const RECENT_COLLAPSED = 5;

export default function SleepPage() {
  const [open, setOpen] = useState<SleepLog | null>(null);
  const [logs, setLogs] = useState<SleepLog[]>([]);
  const [stats, setStats] = useState<SleepStats | null>(null);
  const [history, setHistory] = useState<SleepHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [showAllNights, setShowAllNights] = useState(false);

  // The log just closed by "I'm awake" — offers optional 1-5 quality chips.
  const [justWoke, setJustWoke] = useState<SleepLog | null>(null);
  // Wake hit the "a completed log already exists for today" conflict.
  const [wakeConflict, setWakeConflict] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [state, logList, statData, hist] = await Promise.all([
        sleepApi.state(),
        sleepApi.logs(30),
        sleepApi.stats(30),
        sleepApi.history(30),
      ]);
      setOpen(state.open);
      setLogs(logList);
      setStats(statData);
      setHistory(hist);
      setNowTs(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sleep data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Tick the "sleeping for…" readout while a log is open.
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [open]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function goToBed() {
    setJustWoke(null);
    setWakeConflict(false);
    run(() => sleepApi.goToBed());
  }

  async function wakeUp() {
    setBusy(true);
    setError(null);
    try {
      const closed = await sleepApi.wake();
      setJustWoke(closed);
      setWakeConflict(false);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /already exists/i.test(e.message)) {
        // Today's night is already logged — offer a one-tap discard instead of
        // the raw error.
        setWakeConflict(true);
      } else {
        setError(e instanceof Error ? e.message : "Request failed");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Delete the open timer ("tapped by mistake" / duplicate-night discard). */
  function discardOpenLog() {
    if (!open) return;
    const id = open.id;
    setWakeConflict(false);
    run(() => sleepApi.deleteLog(id));
  }

  /** Optional quality rating right after waking — patches the closed log. */
  function rateJustWoke(quality: number) {
    if (!justWoke) return;
    const id = justWoke.id;
    setJustWoke(null);
    run(() => sleepApi.updateLog(id, { quality }));
  }

  function openAddForm() {
    setEditingId(null);
    setForm(defaultFormState());
    setFormOpen(true);
  }

  function openEditForm(log: SleepLog) {
    setEditingId(log.id);
    setForm({
      bedTime: isoToLocalInput(log.bedTime),
      wakeTime: log.wakeTime ? isoToLocalInput(log.wakeTime) : "",
      quality: log.quality != null ? String(log.quality) : "",
      notes: log.notes,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function saveForm() {
    run(async () => {
      if (!form.bedTime) throw new Error("Bed time is required");
      const base = {
        bedTime: localInputToIso(form.bedTime),
        quality: form.quality === "" ? null : Number(form.quality),
        notes: form.notes,
      };
      if (editingId != null) {
        const patch: Partial<typeof base & { wakeTime: string }> = { ...base };
        if (form.wakeTime) (patch as Record<string, unknown>).wakeTime = localInputToIso(form.wakeTime);
        await sleepApi.updateLog(editingId, patch);
      } else {
        if (!form.wakeTime) throw new Error("Wake time is required");
        await sleepApi.createLog({ ...base, wakeTime: localInputToIso(form.wakeTime) });
      }
      closeForm();
    });
  }

  function removeLog(log: SleepLog) {
    if (!window.confirm(`Delete the sleep log for ${fmtDate(log.date)}?`)) return;
    run(async () => {
      await sleepApi.deleteLog(log.id);
      closeForm();
    });
  }

  // ---- derived --------------------------------------------------------------

  const lastNight = useMemo(() => logs.find((l) => l.durationHours != null) ?? null, [logs]);
  const target = stats?.targetHours ?? history?.targetHours ?? 8;
  const nights = stats?.nightsLogged ?? 0;

  const sleepingHours = open ? (nowTs - new Date(open.bedTime).getTime()) / 3_600_000 : 0;

  const chartData = useMemo(
    () =>
      (history?.days ?? []).map((d) => ({
        day: new Date(`${d.date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" }),
        hours: d.hours ?? 0,
      })),
    [history],
  );

  const lastNightDelta = (() => {
    if (!lastNight || lastNight.durationHours == null) return { text: `target ${target}h`, dir: "flat" as const };
    const diff = lastNight.durationHours - target;
    const sign = diff >= 0 ? "+" : "-";
    return {
      text: `${sign}${fmtHours(Math.abs(diff))} vs ${target}h target`,
      dir: diff >= 0 ? ("up" as const) : ("down" as const),
    };
  })();

  const driftDelta = (() => {
    if (!stats || stats.bedtimeDriftMinutes == null) {
      return stats ? { text: `${nightsLabel(stats.nightsLogged)} logged`, dir: "flat" as const } : undefined;
    }
    const d = stats.bedtimeDriftMinutes;
    if (Math.abs(d) < 5) return { text: "bedtime steady week over week", dir: "up" as const };
    return {
      text: `bedtime ${Math.abs(d)}m ${d > 0 ? "later" : "earlier"} vs prior week`,
      dir: d > 0 ? ("down" as const) : ("up" as const),
    };
  })();

  const visibleLogs = showAllNights ? logs : logs.slice(0, RECENT_COLLAPSED);

  if (loading) return <p className="empty">Loading sleep data…</p>;

  return (
    <div>
      <h1 className="page-title">Sleep</h1>
      <p className="page-sub">One tap at lights-out and wake-up — every night counts toward its wake date.</p>

      <div className="stack" style={{ gap: 14 }}>
        {error && <p className="error-text">{error}</p>}

        {/* Big state-aware bed / wake button */}
        <div className="card" style={{ textAlign: "center", padding: "30px 16px" }}>
          {open ? (
            <div className="stack" style={{ alignItems: "center", gap: 12 }}>
              <span className="chip">
                Sleeping for {fmtHours(sleepingHours)} · in bed since {fmtClock(open.bedTime)}
              </span>
              <button
                className="btn primary"
                style={{ fontSize: 18, padding: "14px 48px", borderRadius: 12 }}
                onClick={wakeUp}
                disabled={busy}
              >
                I'm awake
              </button>
              {wakeConflict ? (
                <div className="stack" style={{ alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                    Today's night is already logged — this timer looks like a stray.
                  </span>
                  <button className="btn small danger" onClick={discardOpenLog} disabled={busy}>
                    Discard this timer
                  </button>
                </div>
              ) : (
                <>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    Closing the log files the night under today and computes the duration.
                  </span>
                  <button
                    onClick={discardOpenLog}
                    disabled={busy}
                    style={{
                      font: "inherit",
                      fontSize: 12,
                      color: "var(--muted)",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Cancel — tapped by mistake
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="stack" style={{ alignItems: "center", gap: 12 }}>
              {justWoke ? (
                <>
                  <span className="chip">Logged {fmtHours(justWoke.durationHours)} — good morning</span>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>How was it? (optional)</span>
                  <div className="row" style={{ gap: 8, justifyContent: "center" }}>
                    {[1, 2, 3, 4, 5].map((q) => (
                      <button
                        key={q}
                        className="btn small"
                        style={{ minWidth: 42 }}
                        onClick={() => rateJustWoke(q)}
                        disabled={busy}
                        aria-label={`Rate last night ${q} out of 5`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>1 = rough · 5 = great</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                    Heading to sleep? Start the timer — tap again when you wake up.
                  </span>
                  <button
                    className="btn primary"
                    style={{ fontSize: 18, padding: "14px 48px", borderRadius: 12 }}
                    onClick={goToBed}
                    disabled={busy}
                  >
                    Going to bed
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Headline stats */}
        <div className="grid cols-4">
          <StatTile
            label="Last night"
            value={fmtHours(lastNight?.durationHours)}
            delta={lastNightDelta.text}
            deltaDirection={lastNightDelta.dir}
          />
          <StatTile
            label="Last night quality"
            value={lastNight?.quality != null ? `${lastNight.quality}/5` : "—"}
            delta={
              stats?.avgQuality != null ? `avg ${stats.avgQuality}/5 over ${nightsLabel(nights)}` : "not rated yet"
            }
          />
          <StatTile
            label={`Avg bedtime (${nightsLabel(nights)})`}
            value={fmtHHMM(stats?.avgBedTime)}
            delta={
              stats?.bedtimeStdDevMinutes != null
                ? `±${stats.bedtimeStdDevMinutes}m typical spread`
                : "no nights logged yet"
            }
          />
          <StatTile
            label={`Avg wake time (${nightsLabel(nights)})`}
            value={fmtHHMM(stats?.avgWakeTime)}
            delta={driftDelta?.text}
            deltaDirection={driftDelta?.dir}
          />
        </div>

        {/* 30-day duration chart */}
        <ChartCard
          title="Sleep duration — last 30 days"
          sub={
            stats && stats.nightsLogged > 0
              ? `${nightsLabel(stats.nightsLogged)} logged · avg ${fmtHours(stats.avgDurationHours)}${
                  stats.targetAdherencePct != null ? ` · ${stats.targetAdherencePct}% of nights hit the target` : ""
                }`
              : "Nothing logged yet — bars appear as you track nights."
          }
        >
          <HistoryBars
            data={chartData}
            x="day"
            bars={[{ key: "hours", name: "Hours slept", color: "var(--series-7)" }]}
            unit="h"
            referenceY={{ value: target, label: `target ${target}h` }}
          />
        </ChartCard>

        <div className="grid cols-2" style={{ alignItems: "start" }}>
          {/* Recent log list + inline add/edit form */}
          <div className="card">
            <div className="row between">
              <h3>Recent nights</h3>
              <button className="btn small" onClick={openAddForm} disabled={busy}>
                Add a night
              </button>
            </div>

            {formOpen && (
              <div
                className="stack"
                style={{ margin: "4px 0 14px", padding: 12, border: "1px solid var(--grid)", borderRadius: 8 }}
              >
                <div className="row">
                  <label className="field" style={{ flex: 1 }}>
                    Bed time
                    <input
                      className="input"
                      type="datetime-local"
                      value={form.bedTime}
                      onChange={(e) => setForm({ ...form, bedTime: e.target.value })}
                    />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    Wake time
                    <input
                      className="input"
                      type="datetime-local"
                      value={form.wakeTime}
                      onChange={(e) => setForm({ ...form, wakeTime: e.target.value })}
                    />
                  </label>
                </div>
                <div className="row">
                  <label className="field" style={{ width: 110 }}>
                    Quality
                    <select
                      className="input"
                      value={form.quality}
                      onChange={(e) => setForm({ ...form, quality: e.target.value })}
                    >
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((q) => (
                        <option key={q} value={q}>
                          {q}/5
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    Notes
                    <input
                      className="input"
                      placeholder="woke up twice, late coffee…"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </label>
                </div>
                <div className="row between" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn primary" onClick={saveForm} disabled={busy}>
                      {editingId != null ? "Save changes" : "Add night"}
                    </button>
                    <button className="btn" onClick={closeForm} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                  {editingId != null &&
                    (() => {
                      const editing = logs.find((l) => l.id === editingId);
                      return editing ? (
                        <button className="btn small danger" onClick={() => removeLog(editing)} disabled={busy}>
                          Delete night
                        </button>
                      ) : null;
                    })()}
                </div>
              </div>
            )}

            {logs.length === 0 ? (
              <p className="empty">
                No sleep logged yet. Tap "Going to bed" tonight, or use "Add a night" to backfill.
              </p>
            ) : (
              <div className="stack" style={{ gap: 0 }}>
                {visibleLogs.map((l, i) => (
                  <div
                    key={l.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 0",
                      borderBottom: i === visibleLogs.length - 1 ? "none" : "1px solid var(--grid)",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                      <span>
                        {fmtDate(l.date)} · {fmtClock(l.bedTime)} →{" "}
                        {l.wakeTime ? fmtClock(l.wakeTime) : "sleeping"} · {fmtHours(l.durationHours)} ·{" "}
                        {l.quality != null ? `${l.quality}/5` : "—"}
                      </span>
                      {l.notes && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={l.notes}
                        >
                          {l.notes}
                        </div>
                      )}
                    </div>
                    <button className="btn small" onClick={() => openEditForm(l)} disabled={busy}>
                      Edit
                    </button>
                  </div>
                ))}
                {logs.length > RECENT_COLLAPSED && (
                  <button
                    className="btn small"
                    style={{ alignSelf: "flex-start", marginTop: 10 }}
                    onClick={() => setShowAllNights((v) => !v)}
                  >
                    {showAllNights ? `Show latest ${RECENT_COLLAPSED}` : `Show all ${logs.length}`}
                  </button>
                )}
              </div>
            )}
          </div>

          <AgentChat
            agent="sleep"
            title="Sleep Assistant"
            placeholder='Try: "I slept 11:30 to 7, felt groggy" or "How consistent is my bedtime?"'
            onReply={reload}
          />
        </div>
      </div>
    </div>
  );
}
