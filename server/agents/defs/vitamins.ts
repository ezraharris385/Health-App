// STUB — replaced by the vitamins segment implementation.
import type { AgentDef } from "../framework";
import { getVitaminSummary } from "../../summaries";
import { todayStr } from "../../db";

export const vitaminsAgent: AgentDef = {
  name: "vitamins",
  title: "Micronutrient Assistant",
  persona: "You are the vitamins/micronutrient assistant agent. (Stub — implementation pending.)",
  tools: [],
  buildContext: () => JSON.stringify(getVitaminSummary(todayStr()).coverage),
};
