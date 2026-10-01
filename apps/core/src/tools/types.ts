import type { MethodName, Params, Part, Result, Thread } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import type { InputRecord } from "../domain/inputs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { ToolSpec } from "../providers/types.ts";

/**
 * What a call may change. Decides recovery after a crash (a `none` call can simply be dropped; anything else is
 * reported as "effect unknown") and, with `confirm`, which calls wait for the owner.
 */
export type Effect = "none" | "local" | "external" | "message";

/**
 * When a call waits for the owner's yes: `never`; `untrusted` = only while untrusted content (web, other agents,
 * channel messages) is in the turn's context; `always`. The agent's `autonomy` can tighten or relax it.
 */
export type Confirm = "never" | "untrusted" | "always";

export type ToolContext = {
  agent: AgentRecord;
  thread: Thread;
  run: RunRecord;
  signal: AbortSignal;
  /** Adds or replaces a part of the answer the owner sees (tool card, browser card, widget, sub-thread). */
  upsertPart(match: (p: Part) => boolean, part: Part): void;
  /** A protocol method through the router, as this agent: the same door every client uses. */
  call<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>>;
  /** Hands a task to another agent (a new session, or one to continue): the one a2a path. */
  delegate(
    to: { agent?: AgentRecord | undefined; session?: string | undefined },
    task: string,
    waitMs: number,
  ): Promise<string>;
  /** Asks the owner and waits (durably) for the answer; the same machine confirmations use. */
  askOwner(prompt: string, options?: string[]): Promise<InputRecord>;
};

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema of the arguments, derived from the zod schema. */
  parameters: object;
  effect: Effect;
  confirm: Confirm;
  /** Longest the call may take before it is cut (the turn goes on with an error result). */
  deadlineMs: number;
  /** Checks the model's arguments; a failure goes back to the model as the tool's result. */
  parse(raw: Record<string, unknown>): { ok: true; args: Record<string, unknown> } | { ok: false; error: string };
  /** Short human title for the tool card ("Opened github.com"). Gets the raw arguments. */
  title(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};

type Args = z.ZodObject;

/** One definition per tool: the zod schema is the spec the model sees and the check its arguments go through. */
export function defineTool<S extends Args>(def: {
  name: string;
  description: string;
  args: S;
  effect: Effect;
  confirm?: Confirm;
  deadlineMs: number;
  title(args: Partial<z.input<S>>): string;
  run(args: z.output<S>, ctx: ToolContext): Promise<string>;
}): Tool {
  const { $schema: _, ...parameters } = z.toJSONSchema(def.args, { io: "input" }) as Record<string, unknown>;
  return {
    name: def.name,
    description: def.description,
    parameters,
    effect: def.effect,
    confirm: def.confirm ?? "never",
    deadlineMs: def.deadlineMs,
    parse(raw) {
      const r = def.args.safeParse(raw);
      if (r.success) return { ok: true, args: r.data as Record<string, unknown> };
      const issues = r.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
      return { ok: false, error: `invalid arguments for ${def.name}: ${issues}` };
    },
    title: (a) => def.title(a as Partial<z.input<S>>),
    run: (a, ctx) => def.run(a as z.output<S>, ctx),
  };
}

export const toSpec = (t: Tool): ToolSpec => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
});
