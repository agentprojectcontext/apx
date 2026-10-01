import type { HarnessId, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { ChatItem, Finish, ToolSpec, Usage } from "../providers/types.ts";

/** Everything a harness needs for one turn. The engine owns persistence, cards and limits; the harness runs the loop. */
export type TurnIO = {
  agent: AgentRecord;
  thread: Thread;
  run: RunRecord;
  /** Byte-stable per agent and thread. */
  system: string;
  /** Earlier turns, already projected for the model (native only; external harnesses keep their own). */
  history: ChatItem[];
  /** This turn's user item, already framed (preamble + origin envelope) and logged. */
  input: ChatItem & { role: "user" };
  tools: ToolSpec[];
  /** A contact's turn: the engine must not use any tool of its own either. */
  sealed?: boolean;
  /**
   * The models to try, in order, all run by this harness ("claude/claude-opus-5-5", "gemini/gemini-3.8-flash"; an
   * engine alone means its default model). The router made the list.
   */
  models: string[];
  signal: AbortSignal;
  /** The external harness's own conversation id for this thread, when there is one. */
  sessionId: string | undefined;
  onText(soFar: string): void;
  /** Runs one APX tool with its card and step record. Every harness calls tools through here. */
  execute(callId: string, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  /** Appends items to what the model saw in this turn (native writes as it goes, so a crash keeps them). */
  log(items: ChatItem[]): void;
  /** What the owner added while the turn runs (steer); a loop that can take it mid-turn calls this between steps. */
  takeSteered?(): string[];
  /**
   * An external agent asks to use one of its own tools (edit a file, run a command): our policy answers, asking
   * the owner when it must. `kind` is the protocol's tool kind (read, edit, execute, fetch…).
   */
  approve(req: {
    callId: string;
    title: string;
    kind: string;
    detail?: string | undefined;
    /** The tool's raw input when the agent sends it (a command to run, a file and its diff). */
    input?: unknown;
  }): Promise<boolean>;
  /** An external agent's own tool call, shown as a card and recorded as a step (effects are not ours to know). */
  observe(ev: {
    callId: string;
    title: string;
    kind: string;
    status: "running" | "ok" | "error";
    detail?: string;
  }): void;
};

export type TurnOutcome = {
  text: string;
  model: string;
  finish?: Finish;
  sessionId?: string | undefined;
  usage?: Usage | undefined;
};

export type Harness = { id: HarnessId; run(io: TurnIO): Promise<TurnOutcome> };

/** The model part of a ref for a harness that takes one ("claude/claude-opus-5-5" → "claude-opus-5-5"). */
export const modelPart = (ref: string | undefined): string | undefined => {
  const i = ref?.indexOf("/") ?? -1;
  return ref && i > 0 ? ref.slice(i + 1) : undefined;
};
