// STUB — replaced by the sleep segment implementation.
import type { AgentDef } from "../framework";
import { getSleepHistory } from "../../summaries";

export const sleepAgent: AgentDef = {
  name: "sleep",
  title: "Sleep Assistant",
  persona: "You are the sleep assistant agent. (Stub — implementation pending.)",
  tools: [],
  buildContext: () => JSON.stringify(getSleepHistory(7)),
};
