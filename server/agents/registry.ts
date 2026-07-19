/**
 * Agent registry. Wires the five agent definitions together and gives the
 * master agent its consult_agent tool (added here, not in defs/master.ts, so
 * segment agents can't recurse into each other).
 */
import type { AgentName } from "../../shared/types";
import { consultAgent, type AgentDef, type ToolDef } from "./framework";
import { workoutAgent } from "./defs/workout";
import { nutritionAgent } from "./defs/nutrition";
import { sleepAgent } from "./defs/sleep";
import { vitaminsAgent } from "./defs/vitamins";
import { masterAgent } from "./defs/master";

const SEGMENT_AGENTS: Record<Exclude<AgentName, "master">, AgentDef> = {
  workout: workoutAgent,
  nutrition: nutritionAgent,
  sleep: sleepAgent,
  vitamins: vitaminsAgent,
};

const consultTool: ToolDef = {
  name: "consult_agent",
  description:
    "Consult one of the specialist agents (workout, nutrition, sleep, vitamins) with a specific question or task. The specialist has full access to its segment's live data and tools and will reply with concrete findings. Use this to combine segments — e.g. ask nutrition AND vitamins to jointly design a meal, or ask workout how to adjust training after a heavy eating day. Consult multiple agents (in parallel if independent) and synthesize their answers for the user.",
  input_schema: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        enum: ["workout", "nutrition", "sleep", "vitamins"],
        description: "Which specialist to consult",
      },
      question: {
        type: "string",
        description:
          "The question or task. Include all relevant constraints (e.g. remaining calories, missing nutrients, schedule) so the specialist can answer without follow-ups.",
      },
    },
    required: ["agent", "question"],
  },
  run: async (input: { agent: Exclude<AgentName, "master">; question: string }) => {
    const def = SEGMENT_AGENTS[input.agent];
    if (!def) throw new Error(`Unknown agent: ${input.agent}`);
    const answer = await consultAgent(def, input.question);
    return `[${input.agent} agent's answer]\n${answer}`;
  },
};

const master: AgentDef = {
  ...masterAgent,
  tools: [...masterAgent.tools, consultTool],
};

export const AGENTS: Record<AgentName, AgentDef> = {
  ...SEGMENT_AGENTS,
  master,
};

export function getAgent(name: string): AgentDef | undefined {
  // hasOwnProperty guard: URL params like "constructor" must not resolve
  // through Object.prototype.
  return Object.prototype.hasOwnProperty.call(AGENTS, name)
    ? AGENTS[name as AgentName]
    : undefined;
}
