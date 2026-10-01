import type { Part, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { ToolSpec } from "../providers/types.ts";

/**
 * What a call may change. Decides recovery after a crash (a `none` call can simply be dropped; anything else is
 * reported as "effect unknown") and, later, which calls need confirmation.
 */
export type Effect = "none" | "local" | "external" | "message";

export type ToolContext = {
  agent: AgentRecord;
  thread: Thread;
  run: RunRecord;
  signal: AbortSignal;
  /** Adds or replaces a part of the answer the owner sees (tool card, browser card, widget, sub-thread). */
  upsertPart(match: (p: Part) => boolean, part: Part): void;
  /** Hands a task to another agent: the one a2a path. Returns the answer, or a note that it continues later. */
  delegate(to: AgentRecord, task: string, waitMs: number): Promise<string>;
};

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: object;
  effect: Effect;
  /** Longest the call may take before it is cut (the turn goes on with an error result). */
  deadlineMs: number;
  /** Short human title for the tool card ("Opened github.com"). */
  title(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};

export const toSpec = (t: Tool): ToolSpec => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
});

export const obj = (properties: Record<string, object>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});
export const str = (description: string) => ({ type: "string", description });
