import { useCallback, useEffect, useMemo, useState } from "react";
import type { Exercise } from "@shared/types";
import { AgentChat } from "../../components/AgentChat";
import { StatTile } from "../../viz/ChartKit";
import { todayStr } from "../../api/http";
import {
  workoutApi,
  type PlanFull,
  type SessionFull,
  type WeekSchedule,
} from "../../api/workout";
import { WeekScheduleCard } from "./WeekScheduleCard";
import { GuidedEntryCard } from "./GuidedEntryCard";
import { RecentSessionsCard, SessionLogger } from "./SessionLogger";
import { PerformanceCard } from "./PerformanceCard";
import { PlansCard } from "./PlansCard";
import { ExerciseLibrary } from "./ExerciseLibrary";

export default function WorkoutPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [plans, setPlans] = useState<PlanFull[]>([]);
  const [week, setWeek] = useState<WeekSchedule | null>(null);
  const [sessions, setSessions] = useState<SessionFull[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [ex, pl, wk, se] = await Promise.all([
        workoutApi.exercises(),
        workoutApi.plans(),
        workoutApi.week(),
        workoutApi.sessions({ days: 30 }),
      ]);
      setExercises(ex);
      setPlans(pl);
      setWeek(wk);
      setSessions(se);
      setError(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workout data");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const today = todayStr();

  const weekStats = useMemo(() => {
    if (!week) return { lifting: 0, volume: 0 };
    const lifting = week.days.reduce((a, d) => a + d.sessions.length, 0);
    const volume = sessions
      .filter((s) => s.date >= week.start && s.date <= week.end)
      .reduce((a, s) => a + s.sets.reduce((x, st) => x + st.reps * (st.weight ?? 0), 0), 0);
    return { lifting, volume };
  }, [week, sessions]);

  const todaySchedule = week?.days.find((d) => d.date === today);
  // An open uncompleted session takes precedence as "today".
  const openToday = useMemo(
    () => sessions.find((s) => s.date === today && !s.completedAt),
    [sessions, today],
  );
  const todayTile = openToday
    ? { value: openToday.name || "Workout", delta: "session in progress" }
    : todaySchedule && todaySchedule.scheduled.length > 0
      ? {
          value: todaySchedule.scheduled[0].dayName,
          delta: todaySchedule.scheduled[0].planName,
        }
      : { value: "Rest", delta: "nothing scheduled" };

  if (!loaded) return <p className="empty">Loading…</p>;

  return (
    <div>
      <h1 className="page-title">Workout</h1>
      <p className="page-sub">
        Plans, lifting sessions, and your performance over time.
      </p>
      {error && <p className="error-text">{error}</p>}

      <div className="grid cols-3">
        <StatTile label="Lifting sessions this week" value={weekStats.lifting} />
        <StatTile
          label="Volume this week"
          value={Math.round(weekStats.volume).toLocaleString()}
          delta="lb lifted (reps × weight)"
        />
        <StatTile label="Today" value={todayTile.value} delta={todayTile.delta} />
      </div>

      <div style={{ marginTop: 14 }}>
        <WeekScheduleCard week={week} />
      </div>

      <div style={{ marginTop: 14 }}>
        <SessionLogger
          today={today}
          scheduled={todaySchedule?.scheduled ?? []}
          sessions={sessions}
          exercises={exercises}
          plans={plans}
          onChange={reload}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <GuidedEntryCard
          scheduled={todaySchedule?.scheduled ?? []}
          plans={plans}
          exercises={exercises}
          onChange={reload}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <RecentSessionsCard sessions={sessions} onChange={reload} />
      </div>

      <div style={{ marginTop: 14 }}>
        <PerformanceCard exercises={exercises} sessions={sessions} reloadKey={reloadKey} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <PlansCard plans={plans} exercises={exercises} onChange={reload} />
        <ExerciseLibrary exercises={exercises} onChange={reload} />
      </div>

      <div style={{ marginTop: 14 }}>
        <AgentChat
          agent="workout"
          title="Workout Coach"
          placeholder="Ask for a plan, log your sets ('bench 3×8 at 185 lb'), or log a whole workout in one message."
          onReply={reload}
        />
      </div>
    </div>
  );
}
