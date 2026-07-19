// STUB — replaced by the workout segment implementation.
import type { AgentDef } from "../framework";
import { getWorkoutDaySummary } from "../../summaries";
import { todayStr } from "../../db";

export const workoutAgent: AgentDef = {
  name: "workout",
  title: "Workout Coach",
  persona: "You are the workout coach agent. (Stub — implementation pending.)",
  tools: [],
  buildContext: () => JSON.stringify(getWorkoutDaySummary(todayStr())),
};
