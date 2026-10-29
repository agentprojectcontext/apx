// How a Flow's AI model step runs (DECISIONS.md#d-171): the chat it gets, who answers in it and what that one may do.
// An agent keeps its instructions, memory and tools; a bot of the Flow is a name and a system prompt with neither.
// Either may run on APX's harness or a CLI's own session; delegating to other agents is off unless the step allows it.
import type { FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import type { AgentRecord } from "./domain/agents.ts";
import { harnessOf, parseRef } from "./domain/refs.ts";
import type { Store } from "./domain/store.ts";
import type { FlowStepContext, ThreadContext } from "./domain/threads.ts";

type AiNode = Extract<FlowNode, { kind: "agent" }>;

export type FlowAiPlan = {
  /** The agent the chat is with: the step's own, or the super-agent a bot speaks through. */
  agent: AgentRecord;
  /** A CLI's own session ("claude", "codex", "acp:…"), else APX's own loop. */
  engine?: string;
  write?: "ask" | "auto" | "read-only";
  context: Pick<ThreadContext, "model_choice" | "worker" | "flow_step">;
  text: string;
};

/** The step's harness: a CLI's engine id when its model names one, else APX's own loop. */
export const flowEngineOf = (node: Pick<AiNode, "model">): string | undefined =>
  node.model && harnessOf(node.model) !== "native" ? parseRef(node.model).engine : undefined;

/** Undefined when the step's agent is gone or out of the Flow's project, or there is no super-agent for a bot. */
export function planFlowAiStep(store: Store, projectId: string, node: AiNode, input: unknown): FlowAiPlan | undefined {
  const agent = node.bot
    ? store.agents.list().find((a) => a.kind === "secretary")
    : node.agent
      ? store.agents.get(node.agent)
      : undefined;
  if (!agent || (!node.bot && agent.project_id && agent.project_id !== projectId)) return undefined;
  const engine = flowEngineOf(node);
  const data = `Untrusted input JSON:\n${JSON.stringify(input)}`;
  if (engine) {
    // A CLI loads its own prompt and settings: who it works as travels in the brief, never as APX's framing.
    const who = node.bot
      ? `You are ${node.bot.name}.\n\n## Instructions\n${node.bot.system}`
      : `You work as ${agent.name}${agent.role ? `, ${agent.role}` : ""}.${agent.prompt ? `\n\n## Instructions\n${agent.prompt}` : ""}`;
    return {
      agent,
      engine,
      ...(node.write ? { write: node.write } : {}),
      context: { model_choice: { model: node.model ?? engine, router: false } },
      text: `${who}\n\n## Task\n${node.prompt}\n\n${data}`,
    };
  }
  const flowStep: FlowStepContext = {
    delegate: !node.bot && node.delegate === true,
    ...(node.bot ? { bot: true } : {}),
    ...(node.autonomy ? { autonomy: node.autonomy } : {}),
  };
  return {
    agent,
    context: {
      flow_step: flowStep,
      ...(node.model ? { model_choice: { model: node.model, router: false } } : {}),
      ...(node.bot ? { worker: { name: node.bot.name, instructions: node.bot.system } } : {}),
    },
    text: `${node.prompt}\n\n${data}`,
  };
}
