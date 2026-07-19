/**
 * Vitamins page: today's per-nutrient coverage meters (worst-first), today's
 * supplement checklist with one-tap taken toggles, 30-day average coverage and
 * supplement adherence charts, the supplement manager, and the
 * Micronutrient Assistant chat.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DailyVitaminSummary, Supplement } from "@shared/types";
import {
  vitaminsApi,
  type AdherencePoint,
  type CoverageHistoryPoint,
} from "../../api/vitamins";
import { AgentChat } from "../../components/AgentChat";
import { ChartCard, HistoryBars, Meter, StatTile, TrendLine } from "../../viz/ChartKit";
import { SupplementManager, contentsSummary } from "./SupplementManager";

const HISTORY_DAYS = 30;

const fmtAmt = (n: number) =>
  Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);

export default function VitaminsPage() {
  const [summary, setSummary] = useState<DailyVitaminSummary | null>(null);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [history, setHistory] = useState<CoverageHistoryPoint[]>([]);
  const [adherence, setAdherence] = useState<AdherencePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [sum, supps, hist, adh] = await Promise.all([
        vitaminsApi.summary(),
        vitaminsApi.supplements(),
        vitaminsApi.history(HISTORY_DAYS),
        vitaminsApi.adherence(HISTORY_DAYS),
      ]);
      setSummary(sum);
      setSupplements(supps);
      setHistory(hist);
      setAdherence(adh);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load vitamins data");
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const coverage = useMemo(
    () => (summary ? [...summary.coverage].sort((a, b) => a.percent - b.percent) : []),
    [summary],
  );
  const avgPercent =
    coverage.length === 0
      ? 0
      : Math.round(coverage.reduce((a, c) => a + c.percent, 0) / coverage.length);
  const fullyCovered = coverage.filter((c) => c.percent >= 100).length;
  const worst = coverage[0];
  const takenIds = useMemo(
    () => new Set((summary?.supplementsTaken ?? []).map((t) => t.supplementId)),
    [summary],
  );
  const activeSupps = summary?.activeSupplements ?? [];
  // Count only taken supplements that are still active, so the tile's
  // numerator can never exceed its active-supplement denominator.
  const takenActiveCount = activeSupps.filter((s) => takenIds.has(s.id)).length;

  const historyData = useMemo(
    () => history.map((p) => ({ date: p.date.slice(5), avg: p.avgPercent })),
    [history],
  );
  const adherenceData = useMemo(
    () => adherence.map((p) => ({ date: p.date.slice(5), taken: p.takenCount })),
    [adherence],
  );
  const activeCount = adherence.length > 0 ? adherence[adherence.length - 1].activeCount : 0;

  async function toggleTaken(supplementId: number, next: boolean) {
    setTogglingId(supplementId);
    try {
      // Send the explicit desired state so an accidental double-click replays
      // the same idempotent request instead of toggling the state back.
      await vitaminsApi.toggleTaken(supplementId, undefined, next);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle supplement");
    } finally {
      setTogglingId(null);
    }
  }

  if (error && !summary) return <p className="error-text">{error}</p>;
  if (!summary) return <p className="empty">Loading…</p>;

  return (
    <div>
      <h1 className="page-title">Vitamins</h1>
      <p className="page-sub">
        Daily micronutrient coverage from logged food + supplements marked taken.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="grid cols-4">
        <StatTile label="Average coverage today" value={`${avgPercent}%`} />
        <StatTile
          label="Fully covered"
          value={`${fullyCovered}/${coverage.length}`}
          delta="nutrients at 100%"
        />
        <StatTile
          label="Supplements taken"
          value={`${takenActiveCount}/${activeSupps.length}`}
          delta="of active today"
        />
        <StatTile
          label="Lowest coverage"
          value={worst ? `${worst.percent}%` : "—"}
          delta={worst ? worst.label : "no tracked nutrients"}
        />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Today's coverage</h3>
          <div className="card-sub" style={{ marginTop: 0 }}>
            Worst-first · consumed/target · food + supplement split
          </div>
          {coverage.length === 0 ? (
            <p className="empty">No tracked nutrients configured.</p>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {avgPercent === 0 && (
                <p className="empty" style={{ padding: 0 }}>
                  Nothing counted yet today — log foods with micronutrients on the Nutrition page
                  and tick off supplements below.
                </p>
              )}
              {coverage.map((c) => (
                <Meter
                  key={c.key}
                  label={c.label}
                  percent={c.percent}
                  detail={`${fmtAmt(c.consumed)}/${fmtAmt(c.target)} ${c.unit} · food ${fmtAmt(c.fromFood)} + supp ${fmtAmt(c.fromSupplements)}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <h3>Today's supplements</h3>
            {activeSupps.length === 0 ? (
              <p className="empty">
                No active supplements. Add them in the library below to get a daily checklist.
              </p>
            ) : (
              <div className="stack">
                {activeSupps.map((s) => {
                  const taken = takenIds.has(s.id);
                  return (
                    <div key={s.id} className="row between">
                      <div>
                        <div style={{ fontWeight: 600 }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          {contentsSummary(s.nutrients, 3)}
                        </div>
                      </div>
                      <button
                        className={taken ? "btn small primary" : "btn small"}
                        onClick={() => toggleTaken(s.id, !taken)}
                        disabled={togglingId === s.id}
                      >
                        {taken ? "Taken ✓" : "Mark taken"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <ChartCard
            title={`Average coverage — last ${HISTORY_DAYS} days`}
            sub="Mean coverage % across all tracked nutrients per day"
          >
            <TrendLine
              data={historyData}
              x="date"
              series={[{ key: "avg", name: "Avg coverage" }]}
              unit="%"
              yDomain={[0, 100]}
              height={200}
            />
          </ChartCard>

          <ChartCard
            title={`Supplement adherence — last ${HISTORY_DAYS} days`}
            sub={
              activeCount > 0
                ? `Supplements taken per day vs ${activeCount} active`
                : "Supplements taken per day"
            }
          >
            <HistoryBars
              data={adherenceData}
              x="date"
              bars={[{ key: "taken", name: "Taken" }]}
              height={200}
              referenceY={activeCount > 0 ? { value: activeCount, label: "active" } : undefined}
            />
          </ChartCard>
        </div>
      </div>

      <h2 className="section-title">Manage supplements</h2>
      <SupplementManager supplements={supplements} onChanged={loadAll} />

      <h2 className="section-title">Assistant</h2>
      <AgentChat
        agent="vitamins"
        title="Micronutrient Assistant"
        placeholder="Ask about gaps — e.g. “what am I low on this week, and what should I eat to fix it?”"
        onReply={loadAll}
      />
    </div>
  );
}
