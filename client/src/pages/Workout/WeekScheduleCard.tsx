import { DOW_SHORT, type WeekSchedule } from "../../api/workout";
import { miFromKm } from "../../units";
import { fmtShortDate } from "./tracking";

/** This week at a glance: scheduled plan days vs what actually got logged. */
export function WeekScheduleCard(props: { week: WeekSchedule | null }) {
  const { week } = props;
  return (
    <div className="card">
      <div className="row between">
        <h3>This week</h3>
        {week && (
          <span className="chip" title={`${week.start} → ${week.end}`}>
            {fmtShortDate(week.start)} → {fmtShortDate(week.end)}
          </span>
        )}
      </div>
      {!week ? (
        <p className="empty">Schedule unavailable.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(110px, 1fr))",
              gap: 8,
            }}
          >
            {week.days.map((d) => {
              const trained = d.sessions.length > 0 || d.cardio.length > 0;
              return (
                <div
                  key={d.date}
                  style={{
                    border: d.isToday
                      ? "1.5px solid var(--accent)"
                      : "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    minHeight: 96,
                    background: d.isToday
                      ? "color-mix(in srgb, var(--accent) 6%, transparent)"
                      : undefined,
                  }}
                >
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>
                      {DOW_SHORT[d.dayOfWeek]}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {d.date.slice(5)}
                    </span>
                  </div>
                  <div className="stack" style={{ gap: 4 }}>
                    {d.scheduled.map((s) => (
                      <span
                        key={s.planDayId}
                        className="chip"
                        title={`${s.planName} — ${s.exerciseCount} exercises`}
                        style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}
                      >
                        {s.dayName}
                      </span>
                    ))}
                    {d.sessions.map((s) => (
                      <span
                        key={`s${s.id}`}
                        style={{ fontSize: 11, color: "var(--good-text)" }}
                        title={`${s.setCount} sets`}
                      >
                        ✓ {s.name || "Session"} {s.completedAt ? "" : "(open)"}
                      </span>
                    ))}
                    {d.cardio.map((c) => (
                      <span key={`c${c.id}`} style={{ fontSize: 11, color: "var(--series-5)" }}>
                        ✓ {c.type}{" "}
                        {c.distanceKm > 0
                          ? `${miFromKm(c.distanceKm).toFixed(1)}mi`
                          : c.durationMinutes > 0
                            ? `${c.durationMinutes}min`
                            : ""}
                      </span>
                    ))}
                    {d.scheduled.length === 0 && !trained && (
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>Rest</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
