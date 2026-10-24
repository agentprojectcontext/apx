import type { FileChange, MethodName, Params, Part, Result, Thread, WritePolicy } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import type { ApprovalTarget } from "../domain/approvals.ts";
import type { InputRecord } from "../domain/inputs.ts";
import type { JobRecord } from "../domain/jobs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Worker } from "../domain/threads.ts";
import type { ToolSpec } from "../providers/types.ts";
import type { FolderThread } from "./folders.ts";

/**
 * What a call may change. Decides recovery after a crash (a `none` call can simply be dropped; anything else is
 * reported as "effect unknown") and, with `confirm`, which calls wait for the owner.
 */
export type Effect = "none" | "local" | "external" | "message";

/**
 * When a call waits for the owner's yes: `never`; `untrusted` = only while untrusted content (web, other agents,
 * channel messages) is in the turn's context; `ask` = unless the agent's mode lets it (DECISIONS.md#d-106); `always` =
 * outside total.
 */
export type Confirm = "never" | "untrusted" | "ask" | "always";
/** `url_data`: the URL carries values (a query) that outside content could have put there to send away. */
export type UntrustedWhy = "url_data";
/** How a call keeps its card where the mode would skip it (Tool.keepsCard). */
export type KeepsCard = "card" | "grant";

/** The thread a tool call runs in, with how far its agent reaches: made only by engine/permissions.ts. */
export type ScopedThread = Thread & FolderThread;

export type ToolContext = {
  agent: AgentRecord;
  thread: ScopedThread;
  run: RunRecord;
  signal: AbortSignal;
  /** Whether outside content (web, another agent, a message) is in this turn's context right now. */
  untrusted(): boolean;
  /** This thread's runs already in the model's view (projected history and this run): search skips what it sees. */
  inView?(): ReadonlySet<string>;
  /** The owner-approvable tools of this turn (MCP), by name: what an agent may hand to another one. */
  approvalFor?(name: string): ApprovalTarget | undefined;
  approvalTools?(): string[];
  /** Whether this agent may run that tool without asking the owner: only such a tool can be handed on. */
  usesFreely?(name: string): boolean;
  /** An image the model looks at with this call's result (a picture of the screen); only native turns carry it. */
  see?(image: { media_id: string; mime: string }): void;
  /** Adds or replaces a part of the answer the owner sees (tool card, browser card, widget, sub-thread). */
  upsertPart(match: (p: Part) => boolean, part: Part): void;
  /** A protocol method through the router, as this agent: the same door every client uses. */
  call<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>>;
  /**
   * The same, for the owner: only a tool that always needs the owner's OK has it, and only once they approved this
   * call (its card or their grant), or where its agent's mode or rule lets it run unasked and the tool keeps no card
   * (DECISIONS.md#d-143). An owner-only method, like copying their browser's session, then runs as their own act.
   */
  callAsOwner?<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>>;
  /** Hands a task to another agent or a worker (a new session, or one to continue): the one a2a path. */
  delegate(
    to: {
      agent?: AgentRecord | undefined;
      session?: string | undefined;
      worker?: Worker | undefined;
      project?: string | undefined;
      folder?: string | undefined;
      write?: WritePolicy | undefined;
    },
    task: string,
    waitMs: number,
  ): Promise<string>;
  /**
   * Asks the owner and waits (durably) for the answer; the same machine confirmations use. Unless the agent can
   * continue without it, the question stays open after the turn stops waiting and its answer wakes the agent.
   */
  askOwner(prompt: string, options?: string[], canContinue?: boolean, multi?: boolean): Promise<InputRecord>;
  /** Puts one concrete action to the owner as a card to accept or decline, and waits as askOwner does. */
  proposeAction(action: string, canContinue?: boolean): Promise<InputRecord>;
  /** Takes back this agent's own open question: it ends `withdrawn` and the owner is not told anything new. */
  withdrawQuestion(inputId: string): InputRecord;
  /** Runs a shell command as a terminal job of this run: waits for it (up to timeoutMs) unless `background`. */
  runCommand(o: { command: string; cwd: string; background: boolean; timeoutMs: number }): Promise<{
    job: JobRecord;
    output: string;
  }>;
};

/** What a tool's pre-check may look at: who calls, from which chat. */
export type CheckContext = Pick<ToolContext, "agent" | "thread">;

export type Tool = {
  approval?: ApprovalTarget;
  name: string;
  description: string;
  /** JSON Schema of the arguments, derived from the zod schema. */
  parameters: object;
  effect: Effect;
  /** Fixed, or decided per call from the arguments (a shell command that only reads vs one that deletes). */
  confirm(args: Record<string, unknown>): Confirm;
  /** Why an `untrusted` call waits, when the tool knows better than "outside content is in this turn". */
  untrustedWhy?: UntrustedWhy | undefined;
  /** Longest the call may take before it is cut (the turn goes on with an error result). */
  deadlineMs: number;
  /**
   * The result only shows the owner's own folder (a file, a command that only reads): still framed as data, but it
   * does not count as outside content for confirmations.
   */
  local?: ((args: Record<string, unknown>) => boolean) | undefined;
  /** This call only reads, on this machine (a shell command of known readers): its risk is read (DECISIONS.md#d-098). */
  reads?: ((args: Record<string, unknown>) => boolean) | undefined;
  /** This call changes only the chat's temp folder, nothing of the owner's: no mode asks for it (DECISIONS.md#d-115). */
  scratch?: ((args: Record<string, unknown>) => boolean) | undefined;
  /**
   * It writes files or runs commands in the folder the agent works in: what auto mode lets run without asking (accept
   * edits, only files), short of what always asks.
   */
  workspace?: true | undefined;
  /** A node capability it needs ("location"): offered only while a node lending it is connected. */
  needsCap?: string | undefined;
  /** Offered in a thread only when this says so (an account connected and on in the thread's project). */
  when?: ((thread: Thread) => boolean) | undefined;
  /**
   * Cheap checks of the parsed arguments against APX's own state (the task exists, the column is real), run before
   * the owner is asked: nobody approves a call that could only fail. Throws what the call itself would.
   */
  check?: ((args: Record<string, unknown>, ctx: CheckContext) => void | Promise<void>) | undefined;
  /**
   * The folders outside the agent's own this call would read (tools/folders.ts outsideFolders): the owner is asked to
   * let it, and the call then runs with them lent (`thread.lent`) instead of being refused.
   */
  outside?: ((args: Record<string, unknown>, ctx: CheckContext) => string[]) | undefined;
  /** What the call would change in a file, shown to the owner when they are asked to confirm it. */
  preview?: ((args: Record<string, unknown>, ctx: CheckContext) => Promise<FileChange | undefined>) | undefined;
  /** What the owner reads about the call when asked to confirm it, in place of arguments that say nothing (an id). */
  explain?: ((args: Record<string, unknown>) => string | undefined) | undefined;
  /**
   * The call changes what the owner set up (their contacts, channels, agents, settings): it runs only on the owner's
   * own word in this chat, never another agent's, and always on their card, whatever the mode (DECISIONS.md#d-140).
   */
  ownerSetting?: ((args: Record<string, unknown>) => boolean) | undefined;
  /**
   * Total and the agent's own rule `auto` do not skip this call's card (DECISIONS.md#d-143): `card`, nothing does, not
   * even a grant; `grant`, only the owner's grant for it does. An ownerSetting call is always `card`.
   */
  keepsCard?: ((args: Record<string, unknown>, agent: AgentRecord) => KeepsCard | undefined) | undefined;
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
  confirm?: Confirm | ((args: z.output<S>) => Confirm);
  untrustedWhy?: UntrustedWhy;
  deadlineMs: number;
  local?: (args: z.output<S>) => boolean;
  reads?: (args: z.output<S>) => boolean;
  scratch?: (args: z.output<S>) => boolean;
  workspace?: true;
  needsCap?: string;
  when?: (thread: Thread) => boolean;
  check?: (args: z.output<S>, ctx: CheckContext) => void | Promise<void>;
  outside?: (args: z.output<S>, ctx: CheckContext) => string[];
  preview?: (args: z.output<S>, ctx: CheckContext) => Promise<FileChange | undefined>;
  explain?: (args: z.output<S>) => string | undefined;
  ownerSetting?: (args: z.output<S>) => boolean;
  keepsCard?: (args: z.output<S>, agent: AgentRecord) => KeepsCard | undefined;
  title(args: Partial<z.input<S>>): string;
  run(args: z.output<S>, ctx: ToolContext): Promise<string>;
}): Tool {
  const { $schema: _, ...parameters } = z.toJSONSchema(def.args, { io: "input" }) as Record<string, unknown>;
  return {
    name: def.name,
    description: def.description,
    parameters,
    effect: def.effect,
    confirm: (a) => (typeof def.confirm === "function" ? def.confirm(a as z.output<S>) : (def.confirm ?? "never")),
    deadlineMs: def.deadlineMs,
    ...(def.untrustedWhy ? { untrustedWhy: def.untrustedWhy } : {}),
    ...(def.workspace ? { workspace: true as const } : {}),
    ...(def.needsCap ? { needsCap: def.needsCap } : {}),
    ...(def.when ? { when: def.when } : {}),
    ...(def.check
      ? { check: (a: Record<string, unknown>, ctx: CheckContext) => def.check?.(a as z.output<S>, ctx) }
      : {}),
    ...(def.outside
      ? { outside: (a: Record<string, unknown>, ctx: CheckContext) => def.outside?.(a as z.output<S>, ctx) ?? [] }
      : {}),
    ...(def.preview
      ? { preview: async (a: Record<string, unknown>, ctx: CheckContext) => def.preview?.(a as z.output<S>, ctx) }
      : {}),
    ...(def.explain ? { explain: (a: Record<string, unknown>) => def.explain?.(a as z.output<S>) } : {}),
    ...(def.ownerSetting
      ? { ownerSetting: (a: Record<string, unknown>) => def.ownerSetting?.(a as z.output<S>) === true }
      : {}),
    ...(def.keepsCard
      ? { keepsCard: (a: Record<string, unknown>, agent: AgentRecord) => def.keepsCard?.(a as z.output<S>, agent) }
      : {}),
    ...(def.local ? { local: (a: Record<string, unknown>) => def.local?.(a as z.output<S>) === true } : {}),
    ...(def.reads ? { reads: (a: Record<string, unknown>) => def.reads?.(a as z.output<S>) === true } : {}),
    ...(def.scratch ? { scratch: (a: Record<string, unknown>) => def.scratch?.(a as z.output<S>) === true } : {}),
    parse(raw) {
      const r = def.args.safeParse(raw);
      if (r.success) return { ok: true, args: r.data as Record<string, unknown> };
      return { ok: false, error: invalidArguments(def.name, r.error) };
    },
    title: (a) => def.title(a as Partial<z.input<S>>),
    run: (a, ctx) => def.run(a as z.output<S>, ctx),
  };
}

/** What the model reads back when its arguments do not fit the tool's schema. */
export function invalidArguments(tool: string, error: z.ZodError): string {
  return `invalid arguments for ${tool}: ${error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ")}`;
}

/** Length and count bounds the arguments are still checked against here (zod): sent, they only cost prompt. */
const SIZE_KEYS = new Set(["minLength", "maxLength", "minItems", "maxItems"]);

/** The JSON schema the model reads, without the size bounds every call would carry for nothing (rules/PROMPT_SIZE.md). */
function withoutSizes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutSizes);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node).flatMap(([k, v]) =>
      // Inside `properties` the keys are argument names, never bounds: an argument may be called "maxLength".
      SIZE_KEYS.has(k) && typeof v === "number" ? [] : [[k, withoutSizes(v)]],
    ),
  );
}

export const toSpec = (t: Tool): ToolSpec => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
});

const slim = new WeakMap<object, ToolSpec>();

/**
 * A tool as our own loop sends it to the model: its schema without size bounds, still checked here. Claude Code and
 * Codex keep the full schema, through APX's MCP server.
 */
export function modelSpec(spec: ToolSpec): ToolSpec {
  let out = slim.get(spec.function.parameters);
  if (!out || out.function.name !== spec.function.name || out.function.description !== spec.function.description) {
    out = { ...spec, function: { ...spec.function, parameters: withoutSizes(spec.function.parameters) as object } };
    slim.set(spec.function.parameters, out);
  }
  return out;
}
