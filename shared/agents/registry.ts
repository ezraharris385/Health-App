/**
 * Agent registry. Wires the six agent definitions together and gives the
 * master agent its consult_agent tool (added here, not in defs/master.ts, so
 * segment agents can't recurse into each other).
 */
import type { AgentName } from "../types";
import { consultAgent, type AgentDef, type ToolDef } from "./framework";
import { workoutAgent } from "./defs/workout";
import { nutritionAgent } from "./defs/nutrition";
import { sleepAgent } from "./defs/sleep";
import { vitaminsAgent } from "./defs/vitamins";
import { mobilityAgent } from "./defs/mobility";
import { masterAgent } from "./defs/master";

const SEGMENT_AGENTS: Record<Exclude<AgentName, "master">, AgentDef> = {
  workout: workoutAgent,
  nutrition: nutritionAgent,
  sleep: sleepAgent,
  vitamins: vitaminsAgent,
  mobility: mobilityAgent,
};

/**
 * Tool names that modify user data. Memory tools (save/update/delete_memory)
 * are deliberately not matched — recording learnings is always allowed.
 */
const WRITE_TOOL_RE = /^(create|update|delete|log|toggle|set|mark|add|archive)_(?!.*memory$)/;

const consultTool: ToolDef = {
  name: "consult_agent",
  description:
    "Consult one of the specialist agents (workout, nutrition, sleep, vitamins, mobility) with a specific question or task. The specialist has full read access to its segment's live data and replies with concrete findings. Specialists only ADVISE during a consultation: they will not modify the user's data unless your question explicitly relays a direct user instruction to record something specific (e.g. \"the user asked to log 2 eggs at lunch\"). Never phrase your own recommendation as an instruction to write data — relay the advice to the user and let them decide. Use this to combine segments — e.g. ask nutrition AND vitamins to jointly design a meal, or ask workout how to adjust training after a heavy eating day. Consult multiple agents (in parallel if independent) and synthesize their answers for the user.",
  input_schema: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        enum: ["workout", "nutrition", "sleep", "vitamins", "mobility"],
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
    const { text, toolEvents } = await consultAgent(def, input.question);
    // Surface any data writes the specialist performed so they can never
    // happen silently — the coordinator must report them to the user.
    const writes = [...new Set(toolEvents.filter((t) => WRITE_TOOL_RE.test(t)))];
    const writeNote =
      writes.length > 0
        ? `\n\n[NOTE: the specialist modified data during this consultation using: ${writes.join(
            ", ",
          )}. You MUST tell the user exactly what was changed.]`
        : "";
    return `[${input.agent} agent's answer]\n${text}${writeNote}`;
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
