/**
 * Workout Coach agent. Reuses the data-access helpers exported by
 * shared/data/stores/workout.ts so tools and REST routes always agree.
 */
import type { AgentDef, ToolDef } from "../framework";
import { db, todayStr } from "../../data/db";
import { getWorkoutDaySummary } from "../../data/summaries";
import {
  addPlanDayExercise,
  addSet,
  cardioTotalSteps,
  completeSession,
  createCardio,
  createExercise,
  createFullPlan,
  createSession,
  deleteExercise,
  deletePlan,
  deletePlanDayExercise,
  getPerformance,
  getSessionFull,
  getWeekSchedule,
  listCardio,
  listExercises,
  listPlans,
  listSessions,
  logFullSession,
  resolveExistingExerciseId,
  updateCardio,
  updateExercise,
  updatePlan,
  updatePlanDay,
} from "../../data/stores/workout";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const exerciseRefProps = {
  exerciseId: { type: "number", description: "Exercise id (preferred when known)" },
  exerciseName: {
    type: "string",
    description:
      "Exercise name — matched case-insensitively; if it doesn't exist it is created automatically",
  },
} as const;

const tools: ToolDef[] = [
  // ------------------------------------------------------------- exercises
  {
    name: "list_exercises",
    description:
      "List the exercise library (id, name, muscle groups, equipment, form instructions, notes). Optionally filter by a search string matched against name and muscle groups. Always check here before creating exercises to avoid duplicates.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional search string, e.g. 'chest' or 'squat'" },
      },
    },
    run: (input: { query?: string }) => JSON.stringify(listExercises(input?.query)),
  },
  {
    name: "save_exercise",
    description:
      "Create a new exercise (omit id) or update an existing one (pass id). Always fill `instructions` with concise form cues (setup, execution, common mistakes). Pick the right `trackingType` for how the movement is measured: 'weight_reps' (barbell/dumbbell lifts), 'reps' (bodyweight reps like push-ups), 'time' (planks/holds/wall-sits), 'distance' (loaded carries, rowing meters), or 'count' (rounds, throws). Fill `intensityRec` with concrete intensity guidance (e.g. 'RPE 8, ~2 in reserve' or '~75% 1RM') and `goalRec` with a target (e.g. '3×8-12 for hypertrophy', '3×45s holds').",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Existing exercise id to update; omit to create" },
        name: { type: "string" },
        muscleGroups: { type: "string", description: "Comma-separated, e.g. 'chest, triceps'" },
        equipment: { type: "string", description: "e.g. 'barbell', 'dumbbells', 'bodyweight'" },
        instructions: { type: "string", description: "Form cues: setup, execution, mistakes" },
        trackingType: {
          type: "string",
          enum: ["weight_reps", "reps", "time", "distance", "count"],
          description: "How a set is measured (default 'weight_reps')",
        },
        intensityRec: {
          type: "string",
          description: "Recommended intensity, e.g. 'RPE 8, ~2 reps in reserve' or '~75% 1RM'",
        },
        goalRec: {
          type: "string",
          description: "Recommended goal/target, e.g. '3×8-12 for hypertrophy' or '3×45s holds'",
        },
        notes: { type: "string" },
      },
    },
    run: (input: {
      id?: number;
      name?: string;
      muscleGroups?: string;
      equipment?: string;
      instructions?: string;
      trackingType?: string;
      intensityRec?: string;
      goalRec?: string;
      notes?: string;
    }) => {
      if (input.id !== undefined && input.id !== null) {
        return JSON.stringify(updateExercise(Number(input.id), input));
      }
      return JSON.stringify(createExercise({ ...input, name: input.name }));
    },
  },
  {
    name: "delete_exercise",
    description:
      "Delete an exercise from the library by id. Destructive: this also removes it from plan days and deletes its logged sets. Confirm with the user before calling.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    run: (input: { id: number }) => {
      deleteExercise(Number(input.id));
      return JSON.stringify({ ok: true, deletedExerciseId: Number(input.id) });
    },
  },
  // ----------------------------------------------------------------- plans
  {
    name: "list_plans",
    description:
      "List workout plans with their full structure: days (name, dayOfWeek 0=Sunday..6=Saturday, null=unscheduled) and each day's ordered exercises (sets/reps/target weight/rest). Read this before editing plans or scheduling.",
    input_schema: {
      type: "object",
      properties: {
        includeArchived: { type: "boolean", description: "Include archived plans (default false)" },
      },
    },
    run: (input: { includeArchived?: boolean }) =>
      JSON.stringify(listPlans(Boolean(input?.includeArchived))),
  },
  {
    name: "create_full_plan",
    description:
      "Create a COMPLETE workout plan in one call: the plan, its weekly-scheduled days, and each day's ordered exercises. Reference exercises by exerciseId or exerciseName — unknown names are created automatically (include muscleGroups/equipment/instructions for those so the library stays useful). Use this whenever the user asks for a program (e.g. push/pull/legs, upper/lower, 5x5).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Plan name, e.g. 'Push Pull Legs'" },
        description: { type: "string" },
        goal: { type: "string", description: "e.g. 'hypertrophy', 'strength', 'general fitness'" },
        days: {
          type: "array",
          description: "The plan's training days, in order",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "e.g. 'Push A'" },
              dayOfWeek: {
                type: ["number", "null"],
                description: "0=Sunday..6=Saturday; null for an unscheduled template day",
              },
              exercises: {
                type: "array",
                description: "Ordered exercises for the day",
                items: {
                  type: "object",
                  properties: {
                    ...exerciseRefProps,
                    muscleGroups: { type: "string" },
                    equipment: { type: "string" },
                    instructions: { type: "string", description: "Form cues if creating a new exercise" },
                    trackingType: {
                      type: "string",
                      enum: ["weight_reps", "reps", "time", "distance", "count"],
                      description: "Tracking type if creating a new exercise (default 'weight_reps')",
                    },
                    intensityRec: { type: "string", description: "Intensity rec if creating a new exercise" },
                    goalRec: { type: "string", description: "Goal rec if creating a new exercise" },
                    sets: { type: "number", description: "Working sets (default 3)" },
                    reps: { type: "string", description: "Rep target, e.g. '8-12' or '5'" },
                    targetWeight: { type: "number", description: "Target working weight" },
                    restSeconds: { type: "number", description: "Rest between sets in seconds" },
                    targetSeconds: { type: "number", description: "Target hold/work seconds for a timed exercise" },
                    targetDistanceM: { type: "number", description: "Target distance in meters for a distance exercise" },
                    targetCount: { type: "number", description: "Target count for a count-tracked exercise" },
                    notes: { type: "string" },
                  },
                },
              },
            },
            required: ["name"],
          },
        },
      },
      required: ["name", "days"],
    },
    run: (input: any) => JSON.stringify(createFullPlan(input)),
  },
  {
    name: "update_plan",
    description:
      "Update a plan's name, description, goal, or archive/unarchive it (archived plans drop out of the weekly schedule). Confirm with the user before archiving.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        description: { type: "string" },
        goal: { type: "string" },
        archived: { type: "boolean" },
      },
      required: ["id"],
    },
    run: (input: {
      id: number;
      name?: string;
      description?: string;
      goal?: string;
      archived?: boolean;
    }) => JSON.stringify(updatePlan(Number(input.id), input)),
  },
  {
    name: "delete_plan",
    description:
      "Permanently delete a plan and all of its days/exercise assignments. Destructive — confirm with the user first; prefer update_plan with archived=true to retire a plan.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    run: (input: { id: number }) => {
      deletePlan(Number(input.id));
      return JSON.stringify({ ok: true, deletedPlanId: Number(input.id) });
    },
  },
  {
    name: "update_plan_day",
    description:
      "Modify one day of a plan: rename it, move it to another weekday (dayOfWeek 0=Sunday..6=Saturday, null=unscheduled), reorder its exercises (exerciseOrder = plan-day-exercise ids in the new order), add exercises, or remove exercises (removeExerciseIds = plan-day-exercise ids). Get ids from list_plans first.",
    input_schema: {
      type: "object",
      properties: {
        planDayId: { type: "number" },
        name: { type: "string" },
        dayOfWeek: { type: ["number", "null"], description: "0=Sunday..6=Saturday, or null" },
        exerciseOrder: {
          type: "array",
          items: { type: "number" },
          description: "Plan-day-exercise ids in the desired new order",
        },
        addExercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ...exerciseRefProps,
              trackingType: {
                type: "string",
                enum: ["weight_reps", "reps", "time", "distance", "count"],
                description: "Tracking type if creating a new exercise",
              },
              intensityRec: { type: "string" },
              goalRec: { type: "string" },
              sets: { type: "number" },
              reps: { type: "string" },
              targetWeight: { type: "number" },
              restSeconds: { type: "number" },
              targetSeconds: { type: "number", description: "Target hold/work seconds (timed)" },
              targetDistanceM: { type: "number", description: "Target distance in meters" },
              targetCount: { type: "number", description: "Target count (count-tracked)" },
              notes: { type: "string" },
            },
          },
        },
        removeExerciseIds: {
          type: "array",
          items: { type: "number" },
          description: "Plan-day-exercise ids to remove from the day",
        },
      },
      required: ["planDayId"],
    },
    run: (input: {
      planDayId: number;
      name?: string;
      dayOfWeek?: number | null;
      exerciseOrder?: number[];
      addExercises?: any[];
      removeExerciseIds?: number[];
    }) => {
      const dayId = Number(input.planDayId);
      return db.transaction(() => {
        if (Array.isArray(input.removeExerciseIds)) {
          for (const id of input.removeExerciseIds) deletePlanDayExercise(Number(id));
        }
        if (Array.isArray(input.addExercises)) {
          for (const ex of input.addExercises) addPlanDayExercise(dayId, ex);
        }
        return JSON.stringify(updatePlanDay(dayId, input));
      })();
    },
  },
  // -------------------------------------------------------------- sessions
  {
    name: "get_week_schedule",
    description:
      "Get the weekly schedule for the week containing a date (default: this week): per day, which plan days are scheduled, which lifting sessions were logged (with set counts), and cardio. Use this to answer 'what's on this week' and to spot skipped days.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Any YYYY-MM-DD inside the desired week" },
      },
    },
    run: (input: { date?: string }) => JSON.stringify(getWeekSchedule(input?.date)),
  },
  {
    name: "list_sessions",
    description:
      "List recent lifting sessions with all logged sets (exercise, reps, weight, RPE) — newest first. Use days to control the window, or date for one specific day.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look-back window in days (default 30)" },
        date: { type: "string", description: "Exact YYYY-MM-DD instead of a window" },
      },
    },
    run: (input: { days?: number; date?: string }) => JSON.stringify(listSessions(input ?? {})),
  },
  {
    name: "log_session",
    description:
      "Open a LIVE lifting session for mid-workout, set-by-set logging (optionally seeding its first sets); keep appending with add_sets as the workout happens. For a workout that is already FINISHED, use log_full_session instead. Pass planDayId to start from a scheduled plan day (name auto-fills). Each set needs exerciseId or exerciseName plus at least one measured field (reps, weight, durationSeconds, distanceM, or count); rpe (1-10) is optional intensity. Set completed=true only if the session is already over. Returns the full session with sets.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD (default today)" },
        planDayId: { type: "number", description: "Plan day this session follows (optional)" },
        name: { type: "string", description: "Session name (defaults from the plan day)" },
        notes: { type: "string" },
        completed: { type: "boolean", description: "Mark completed immediately" },
        sets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ...exerciseRefProps,
              reps: { type: "number", description: "Reps (omit for time/distance/count-only work)" },
              weight: { type: "number" },
              rpe: { type: "number", description: "1-10 rate of perceived exertion" },
              durationSeconds: {
                type: "number",
                description: "Seconds of timed work for the set (1-21600)",
              },
              distanceM: { type: "number", description: "Meters covered (distance-tracked work), >= 0" },
              count: { type: "number", description: "Plain count, e.g. rounds/throws (integer >= 0)" },
              notes: { type: "string" },
            },
          },
        },
      },
    },
    run: (input: {
      date?: string;
      planDayId?: number;
      name?: string;
      notes?: string;
      completed?: boolean;
      sets?: any[];
    }) =>
      JSON.stringify(
        db.transaction(() => {
          const session = createSession(input ?? {});
          if (Array.isArray(input?.sets)) {
            for (const s of input.sets) addSet(session.id, s);
          }
          if (input?.completed) completeSession(session.id);
          return getSessionFull(session.id);
        })(),
      ),
  },
  {
    name: "log_full_session",
    description:
      "Log a COMPLETE workout in one call — typically what the user actually did against a plan-day template. Pass planDayId when they followed a scheduled day (name auto-fills). Include ONLY the exercises actually performed, each with its real sets count and per-set measurements: reps/weight/intensity (rpe 1-10) for lifts, durationSeconds for timed holds, distanceM for distance work, count for count-tracked work. Each set needs at least one measured field. Omit skipped template exercises entirely — extra non-template exercises are welcome. The session is recorded as already completed. Returns the full session with sets.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD (default today)" },
        planDayId: {
          type: "number",
          description: "Plan day the workout followed; omit for a freestyle workout",
        },
        name: { type: "string", description: "Session name (defaults from the plan day, else 'Workout')" },
        notes: { type: "string" },
        entries: {
          type: "array",
          description:
            "One entry per exercise ACTUALLY performed; `sets` identical set rows are recorded per entry",
          items: {
            type: "object",
            properties: {
              ...exerciseRefProps,
              trackingType: {
                type: "string",
                enum: ["weight_reps", "reps", "time", "distance", "count"],
                description: "Tracking type if creating a new exercise by name",
              },
              sets: { type: "number", description: "Sets performed (1-20, default 1)" },
              reps: {
                type: "number",
                description: "Reps per set (0-1000); omit for time/distance/count-only work",
              },
              weight: { type: "number", description: "Working weight (>= 0); omit for bodyweight" },
              rpe: { type: "number", description: "Intensity: 1-10 rate of perceived exertion" },
              durationSeconds: {
                type: "number",
                description: "Seconds of timed work per set (1-21600), e.g. 60 for a 1-minute plank",
              },
              distanceM: { type: "number", description: "Meters covered per set (distance-tracked work), >= 0" },
              count: { type: "number", description: "Plain count per set, e.g. rounds/throws (integer >= 0)" },
              notes: { type: "string" },
            },
          },
        },
      },
      required: ["entries"],
    },
    run: (input: any) => JSON.stringify(logFullSession(input)),
  },
  {
    name: "add_sets",
    description:
      "Append sets to an existing session (e.g. mid-workout logging: 'bench 100kg for 8'). Each set needs exerciseId or exerciseName plus at least one measured field: reps, weight, durationSeconds (timed work), distanceM (distance work), or count (count-tracked work); rpe is optional intensity. Set numbers auto-increment per exercise.",
    input_schema: {
      type: "object",
      properties: {
        sessionId: { type: "number" },
        sets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ...exerciseRefProps,
              reps: { type: "number", description: "Reps (omit for time/distance/count-only work)" },
              weight: { type: "number" },
              rpe: { type: "number" },
              durationSeconds: {
                type: "number",
                description: "Seconds of timed work for the set (1-21600)",
              },
              distanceM: { type: "number", description: "Meters covered (distance-tracked work), >= 0" },
              count: { type: "number", description: "Plain count, e.g. rounds/throws (integer >= 0)" },
              notes: { type: "string" },
            },
          },
        },
      },
      required: ["sessionId", "sets"],
    },
    run: (input: { sessionId: number; sets: any[] }) => {
      if (!Array.isArray(input.sets) || input.sets.length === 0) {
        throw new Error("sets must be a non-empty array");
      }
      return JSON.stringify(
        db.transaction(() => {
          for (const s of input.sets) addSet(Number(input.sessionId), s);
          return getSessionFull(Number(input.sessionId));
        })(),
      );
    },
  },
  {
    name: "complete_session",
    description: "Mark a lifting session as completed (sets its completion timestamp).",
    input_schema: {
      type: "object",
      properties: { sessionId: { type: "number" } },
      required: ["sessionId"],
    },
    run: (input: { sessionId: number }) =>
      JSON.stringify(completeSession(Number(input.sessionId))),
  },
  // ----------------------------------------------------------- performance
  {
    name: "get_performance",
    description:
      "Per-exercise performance history: for each training day, total volume (Σ reps × weight), best set, and Epley estimated 1RM. Use it to judge progressive overload and recommend next working weights. Reference the exercise by id or name — it must already exist; this read-only query never creates one (use list_exercises to find the right id/name).",
    input_schema: {
      type: "object",
      properties: {
        ...exerciseRefProps,
        exerciseName: {
          type: "string",
          description:
            "Exercise name — matched case-insensitively; must already exist (this read-only query never creates it)",
        },
        days: { type: "number", description: "Look-back window in days (default 180)" },
      },
    },
    run: (input: { exerciseId?: number; exerciseName?: string; days?: number }) => {
      // Read-only: resolve to an EXISTING exercise only. Never create from a
      // performance query, or a typo/novel name would pollute the library and
      // return a misleading "no data" instead of "no such exercise".
      const id = resolveExistingExerciseId(input ?? {});
      return JSON.stringify(getPerformance(id, input?.days ?? 180));
    },
  },
  // ----------------------------------------------------------------- cardio
  {
    name: "log_cardio",
    description:
      "Log a cardio session of any type: run/jog/walk/interval (footfall), hiit, cycling, rowing, elliptical, or other. distanceKm and durationMinutes are BOTH optional (0 allowed) — a session just needs at least one of distance, duration, steps, stepsRun, or stepsWalked, so a steps-only day (e.g. 8000 steps walked, no distance) or a duration-only HIIT/cycling session both work. For type 'other' set activityLabel (e.g. 'stair climber'). Steps auto-estimate from distance for footfall types; pass stepsRun/stepsWalked to record explicit device counts, or steps for a manual total override. intensity is 1-10.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD (default today)" },
        type: {
          type: "string",
          enum: ["run", "jog", "walk", "interval", "hiit", "cycling", "rowing", "elliptical", "other"],
        },
        activityLabel: {
          type: "string",
          description: "Free-text label for the activity, especially for type 'other'",
        },
        distanceKm: { type: "number", description: "Optional (0 allowed for non-distance activities)" },
        durationMinutes: { type: "number", description: "Optional (0 allowed for steps-only entries)" },
        intensity: { type: "number", description: "1-10 (default 5)" },
        steps: { type: "number", description: "Manual total-step override; omit to auto-estimate/use run+walked" },
        stepsRun: { type: "number", description: "Explicit run-step count (device); omit to auto-estimate" },
        stepsWalked: { type: "number", description: "Explicit walked-step count (device); omit to auto-estimate" },
        report: { type: "string", description: "The user's report of how it went — always ask for one" },
        notes: { type: "string" },
      },
      required: ["type"],
    },
    run: (input: any) => JSON.stringify(createCardio(input)),
  },
  {
    name: "update_cardio",
    description:
      "Update a cardio session by id — most commonly to attach or refine the user's post-session report (how it felt, pacing, aches), or to fix type/activityLabel/distance/duration/intensity. Pass steps as a number to hardcode a manual total, or null to clear it. Pass stepsRun/stepsWalked to set explicit device counts (null clears back to auto). Estimated steps re-estimate automatically when type/distance change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number" },
        date: { type: "string" },
        type: {
          type: "string",
          enum: ["run", "jog", "walk", "interval", "hiit", "cycling", "rowing", "elliptical", "other"],
        },
        activityLabel: { type: "string" },
        distanceKm: { type: "number" },
        durationMinutes: { type: "number" },
        intensity: { type: "number" },
        steps: { type: ["number", "null"] },
        stepsRun: { type: ["number", "null"] },
        stepsWalked: { type: ["number", "null"] },
        report: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
    run: (input: {
      id: number;
      date?: string;
      type?: string;
      activityLabel?: string;
      distanceKm?: number;
      durationMinutes?: number;
      intensity?: number;
      steps?: number | null;
      stepsRun?: number | null;
      stepsWalked?: number | null;
      report?: string;
      notes?: string;
    }) => JSON.stringify(updateCardio(Number(input.id), input)),
  },
  {
    name: "get_cardio_history",
    description:
      "List cardio sessions (newest first) including distance, duration, pace-relevant fields, intensity, effective steps, and the user's free-text reports. Read the reports before giving running/walking advice — they carry how each session actually felt.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look-back window in days (default 90)" },
      },
    },
    run: (input: { days?: number }) =>
      JSON.stringify(
        listCardio(input?.days ?? 90).map((c) => ({
          ...c,
          totalSteps: cardioTotalSteps(c),
          paceMinPerKm:
            c.distanceKm > 0
              ? Math.round((c.durationMinutes / c.distanceKm) * 100) / 100
              : null,
        })),
      ),
  },
];

export const workoutAgent: AgentDef = {
  name: "workout",
  title: "Workout Coach",
  persona: `You are the Workout Coach — an expert strength & conditioning coach (think NSCA-CSCS level) inside the user's personal health app. You own everything training-related: the exercise library, weekly workout plans, lifting sessions with set-by-set logs, per-exercise performance history, and cardio of every kind (runs, jogs, walks, intervals, HIIT, cycling, rowing, elliptical, and anything else).

How you work:
- Every turn you receive an auto-injected <context> snapshot of today's training data (schedule, sessions, cardio, active plans, last-7-days load) plus your saved memory notes about the user. Use both before asking questions the data already answers.
- Read before you write: call list_exercises / list_plans / list_sessions / get_week_schedule to see current state before creating or editing anything. Never create duplicate exercises.
- Every exercise carries a trackingType — pick the right one when you create it: 'weight_reps' (loaded lifts), 'reps' (bodyweight reps), 'time' (planks/holds), 'distance' (carries, rowing meters), or 'count' (rounds/throws). Also fill intensityRec (concrete: e.g. 'RPE 8, ~2 in reserve' or '~75% 1RM') and goalRec (a target, e.g. '3×8-12 for hypertrophy', '3×45s holds'). You recommend intensity and goals in TEXT — you have no charts or visuals to draw.
- When the user asks for a program, build it in ONE create_full_plan call — plan, weekly days (dayOfWeek 0=Sunday..6=Saturday), and ordered exercises with sets, reps, target weight/rest, plus targetSeconds/targetDistanceM/targetCount for timed/distance/count work. Pick sensible defaults from their history via get_performance instead of guessing.
- Always write form cues into each exercise's instructions field, and quote those instructions when explaining how to perform a movement (setup, execution, common mistakes).
- When the user reports a FINISHED workout (especially one from a plan day), prefer log_full_session — one call records the whole completed session. First ask what they ACTUALLY did versus the template; never assume template values were performed unless the user says so. Each set carries whatever fits its tracking type: reps+weight, a durationSeconds hold, a distanceM, or a plain count — a set only needs one measured field. Include only exercises actually done (skipped ones omitted; extras fine). Keep log_session/add_sets for live set-by-set logging mid-workout.
- After logging anything, confirm concretely what was recorded ("Logged Bench 3×8 @ 80kg, RPE 8" / "Logged Plank 3×45s"). Confirm before destructive changes (deleting plans/exercises); prefer archiving plans.
- Cardio: works for any activity. distance and duration are both optional — a steps-only day (stepsWalked from a device, no distance) or a duration-only HIIT/cycling/rowing session are both valid; just supply at least one of distance, duration, or steps. Use activityLabel for 'other'. Steps auto-estimate from distance for footfall types; pass stepsRun/stepsWalked for explicit device counts or steps for a manual total. ALWAYS ask for a short post-session report ("How did it feel? Pace, breathing, any aches?") and attach it with update_cardio — then use the reports (get_cardio_history) to analyze pacing, recovery, and recurring pains.
- Coach progressive overload with numbers: use get_performance (volume/1RM for weighted lifts; best hold, distance, or count for other tracking types) to recommend next targets and detect stalls.
- Memory: save durable facts with save_memory — goals, injuries and pain flags from reports, equipment available, schedule constraints, exercise preferences, PRs. Update or delete notes that become stale.

Tone: a genuinely helpful coach — direct, encouraging, concrete numbers and clear next steps, no filler.`,
  tools,
  buildContext: () => {
    const date = todayStr();
    const day = getWorkoutDaySummary(date);
    const allPlans = listPlans(false);
    const plans = allPlans.slice(0, 3).map((p) => ({
      id: p.id,
      name: p.name,
      goal: p.goal,
      days: p.days.length,
      dows: p.days
        .map((d) => d.dayOfWeek)
        .filter((d) => d !== null)
        .join(","),
    }));
    const recent = listSessions({ days: 7 });
    const volume7 = recent.reduce(
      (acc, s) => acc + s.sets.reduce((a, st) => a + st.reps * (st.weight ?? 0), 0),
      0,
    );
    const cardio7 = listCardio(7);
    return JSON.stringify({
      today: {
        date,
        dayOfWeek: DOW[new Date(`${date}T12:00:00`).getDay()],
        scheduledPlanDays: day.scheduledPlanDays,
        sessions: day.sessions,
        cardio: day.cardio.map((c) => ({
          id: c.id,
          type: c.type,
          ...(c.activityLabel ? { label: c.activityLabel } : {}),
          km: c.distanceKm,
          min: c.durationMinutes,
          intensity: c.intensity,
          steps: cardioTotalSteps(c),
          hasReport: c.report.trim().length > 0,
        })),
      },
      activePlans: plans,
      ...(allPlans.length > 3 ? { morePlans: allPlans.length - 3 } : {}),
      last7Days: {
        liftingSessions: recent.length,
        totalVolume: Math.round(volume7),
        cardioSessions: cardio7.length,
        cardioKm: Math.round(cardio7.reduce((a, c) => a + c.distanceKm, 0) * 10) / 10,
      },
    });
  },
};
