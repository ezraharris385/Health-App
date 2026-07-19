// STUB — replaced by the dashboard/master segment implementation.
// NOTE: do NOT add a consult tool here; registry.ts injects consult_agent.
import type { AgentDef } from "../framework";
import { computeDailyScore } from "../../score";
import { todayStr } from "../../db";

export const masterAgent: AgentDef = {
  name: "master",
  title: "Health Coordinator",
  persona: "You are the master health coordinator agent. (Stub — implementation pending.)",
  tools: [],
  buildContext: () => JSON.stringify(computeDailyScore(todayStr())),
};
