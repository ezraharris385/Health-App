// STUB — replaced by the nutrition segment implementation.
import type { AgentDef } from "../framework";
import { getNutritionSummary } from "../../summaries";
import { todayStr } from "../../db";

export const nutritionAgent: AgentDef = {
  name: "nutrition",
  title: "Nutrition Assistant",
  persona: "You are the nutrition assistant agent. (Stub — implementation pending.)",
  tools: [],
  buildContext: () => JSON.stringify(getNutritionSummary(todayStr())),
};
