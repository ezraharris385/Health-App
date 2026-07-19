/**
 * Sleep Assistant agent. Tools reuse the exact validation/write paths of the
 * shared sleep store (shared/data/stores/sleep.ts) — the same code the HTTP
 * API and the in-browser router use — so the agent and the UI can never
 * disagree about the data.
 */
import type { AgentDef, ToolDef } from "../framework";
import { daysAgoStr, todayStr } from "../../data/db";
import { getSettings } from "../../data/settingsStore";
import {
  computeSleepStats,
  createSleepLog,
  deleteSleepLog,
  getLastCompletedSleepLog,
  getOpenSleepLog,
  getRecentSleepLogs,
  getSleepLogById,
  startSleep,
  updateSleepLog,
  wakeUp,
} from "../../data/stores/sleep";

const PERSONA = `You are the Sleep Assistant, the sleep coach inside the user's personal health app. You own everything about sleep: the one-tap bed/wake tracker, manual entries for forgotten nights, quality ratings (1-5), notes, and all sleep history and statistics. A night of sleep is always attributed to its WAKE date — "last night" means today's date.

Coaching philosophy: consistency beats quantity. A steady bedtime and wake time within roughly a 30-minute window does more for energy and mood than the occasional long night. Watch the data for bedtime drift (creeping later week over week), weekday/weekend gaps ("social jet lag"), short-sleep streaks, and quality dips after late bedtimes — get_sleep_stats reports bedtime spread, drift, and day-of-week patterns for exactly this. Ground every piece of advice in the user's actual numbers: cite specific dates, durations, and clock times, and compare against their target hours.

Working method: read before you write. Check get_sleep_status (and get_sleep_stats or get_sleep_history when relevant) before logging or editing anything. When the user reports sleep in natural language ("slept 11:30 to 7, it was rough"), record it with log_sleep — times are ISO datetimes, so resolve relative phrases like "last night" against today's date from the context snapshot — then briefly confirm exactly what you recorded (times, duration, quality). Never delete a log without the user explicitly confirming which one. If they say they're going to bed or just woke up, use start_sleep / end_sleep rather than a manual entry.

Each turn you receive an auto-injected <context> snapshot of today's live sleep data plus your saved memory notes — use them instead of re-asking. Save durable facts with save_memory: target schedule, work shifts, caffeine habits, insomnia patterns, what has helped before.

Tone: a warm, direct sleep coach. Concrete numbers, one clear next step, no filler.`;

const tools: ToolDef[] = [
  {
    name: "get_sleep_status",
    description:
      "Read the current sleep state: the open sleep log if the user is currently tracked as sleeping (with hours elapsed so far), the most recent completed night, and the sleep target. Call this before logging, closing, or editing anything.",
    input_schema: { type: "object", properties: {} },
    run: () => {
      const open = getOpenSleepLog();
      const lastNight = getLastCompletedSleepLog();
      return JSON.stringify({
        currentlySleeping: open
          ? {
              ...open,
              hoursSoFar:
                Math.round(((Date.now() - new Date(open.bedTime).getTime()) / 3_600_000) * 100) / 100,
            }
          : null,
        lastCompletedNight: lastNight,
        targetHours: getSettings().goals.sleepTargetHours,
        today: todayStr(),
      });
    },
  },
  {
    name: "start_sleep",
    description:
      "Open a sleep log — the user is going to bed now. Optionally pass bedTime (ISO datetime, must not be in the future) if they actually turned in a little earlier. Fails if a log is already open. For a fully-past night use log_sleep instead.",
    input_schema: {
      type: "object",
      properties: {
        bedTime: {
          type: "string",
          description: "Optional ISO datetime for when they went to bed; defaults to now",
        },
      },
    },
    run: (input: { bedTime?: string }) => {
      const log = startSleep(input?.bedTime);
      return JSON.stringify({ opened: log });
    },
  },
  {
    name: "end_sleep",
    description:
      "Close the open sleep log — the user woke up. The night is attributed to the wake date. Optionally pass wakeTime (ISO datetime, defaults to now), quality (1-5) and notes. Fails if no log is open.",
    input_schema: {
      type: "object",
      properties: {
        wakeTime: { type: "string", description: "Optional ISO wake datetime; defaults to now" },
        quality: { type: "number", description: "Optional sleep quality 1-5" },
        notes: { type: "string", description: "Optional note about the night" },
      },
    },
    run: (input: { wakeTime?: string; quality?: number; notes?: string }) => {
      const log = wakeUp(input ?? {});
      return JSON.stringify({ closed: log });
    },
  },
  {
    name: "log_sleep",
    description:
      "Record a complete past night (forgotten or reported after the fact). bedTime and wakeTime are ISO datetimes (wake after bed, at most 24h apart); the log's date is the wake date. quality (1-5) and notes are optional.",
    input_schema: {
      type: "object",
      properties: {
        bedTime: { type: "string", description: "ISO datetime the user went to bed" },
        wakeTime: { type: "string", description: "ISO datetime the user woke up" },
        quality: { type: "number", description: "Optional sleep quality 1-5" },
        notes: { type: "string", description: "Optional note about the night" },
      },
      required: ["bedTime", "wakeTime"],
    },
    run: (input: { bedTime: string; wakeTime: string; quality?: number; notes?: string }) => {
      const log = createSleepLog(input);
      return JSON.stringify({ created: log });
    },
  },
  {
    name: "update_sleep_log",
    description:
      "Edit an existing sleep log by id. Only the fields you pass change (bedTime/wakeTime as ISO datetimes, quality 1-5 or null to clear, notes). Setting wakeTime on an open log closes it. The attribution date is recomputed from the wake time. Read the log first (get_sleep_history) so you edit the right one.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Sleep log id" },
        bedTime: { type: "string" },
        wakeTime: { type: "string" },
        quality: { type: ["number", "null"], description: "1-5, or null to clear" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
    run: (input: {
      id: number;
      bedTime?: string;
      wakeTime?: string;
      quality?: number | null;
      notes?: string;
    }) => {
      if (typeof input?.id !== "number") throw new Error("id is required");
      const { id, ...patch } = input;
      const log = updateSleepLog(id, patch);
      return JSON.stringify({ updated: log });
    },
  },
  {
    name: "delete_sleep_log",
    description:
      "Delete a sleep log by id. Destructive — only after the user explicitly confirms which log to remove (quote its date and times back to them first).",
    input_schema: {
      type: "object",
      properties: { id: { type: "number", description: "Sleep log id to delete" } },
      required: ["id"],
    },
    run: (input: { id: number }) => {
      if (typeof input?.id !== "number") throw new Error("id is required");
      const log = getSleepLogById(input.id);
      deleteSleepLog(input.id);
      return JSON.stringify({ deleted: log });
    },
  },
  {
    name: "get_sleep_history",
    description:
      "List recent sleep logs (newest first, open log pinned on top) with ids, bed/wake times, durations, quality and notes. days = how far back to look (default 14, max 365).",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Window in days, default 14, max 365" },
      },
    },
    run: (input: { days?: number }) => {
      const days = input?.days ?? 14;
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        throw new Error("days must be between 1 and 365");
      }
      return JSON.stringify(getRecentSleepLogs(Math.floor(days)).slice(0, 60));
    },
  },
  {
    name: "get_sleep_stats",
    description:
      "Aggregate sleep statistics over a window (default 30 days): average duration and quality, average bed/wake clock times (circular mean), bedtime consistency (std-dev minutes — lower is steadier), bedtime drift (last 7 days vs the 7 before, + = later), % of nights hitting the target, and per-day-of-week averages (weekday vs weekend patterns).",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Window in days, default 30, max 365" },
      },
    },
    run: (input: { days?: number }) => {
      const days = input?.days ?? 30;
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        throw new Error("days must be between 1 and 365");
      }
      return JSON.stringify(computeSleepStats(Math.floor(days)));
    },
  },
];

export const sleepAgent: AgentDef = {
  name: "sleep",
  title: "Sleep Assistant",
  persona: PERSONA,
  tools,
  buildContext: () => {
    const goals = getSettings().goals;
    const open = getOpenSleepLog();
    const recent = getRecentSleepLogs(14);
    const lastNight = getLastCompletedSleepLog();
    const stats = computeSleepStats(30);
    const weekAgo = daysAgoStr(6);
    return JSON.stringify({
      today: todayStr(),
      targetHours: goals.sleepTargetHours,
      currentlySleeping: open
        ? {
            id: open.id,
            since: open.bedTime,
            hoursSoFar:
              Math.round(((Date.now() - new Date(open.bedTime).getTime()) / 3_600_000) * 100) / 100,
          }
        : null,
      lastNight: lastNight
        ? {
            id: lastNight.id,
            date: lastNight.date,
            bedTime: lastNight.bedTime,
            wakeTime: lastNight.wakeTime,
            hours: lastNight.durationHours,
            quality: lastNight.quality,
          }
        : null,
      nightsLoggedLast7: recent.filter((l) => l.durationHours != null && l.date >= weekAgo).length,
      last30: {
        nightsLogged: stats.nightsLogged,
        avgHours: stats.avgDurationHours,
        avgQuality: stats.avgQuality,
        avgBedTime: stats.avgBedTime,
        avgWakeTime: stats.avgWakeTime,
        bedtimeSpreadMin: stats.bedtimeStdDevMinutes,
        bedtimeDriftMin: stats.bedtimeDriftMinutes,
        targetAdherencePct: stats.targetAdherencePct,
      },
    });
  },
};
