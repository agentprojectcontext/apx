import type { HarnessId, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { parseRef } from "../domain/refs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { ChatItem, Finish, ModelFailure, ToolSpec, Usage } from "../providers/types.ts";

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
  /** Model calls our own loop may make before it must answer (it raises it for the browser or the computer). */
  steps?: number | undefined;
  /**
   * The models to try, in order, all run by this harness ("claude/claude-opus-5-5", "gemini/gemini-3.8-flash"; an
   * engine alone means its default model). The router made the list.
   */
  models: string[];
  signal: AbortSignal;
  /** The external harness's own conversation id for this thread, when there is one. */
  sessionId: string | undefined;
  /** Whether outside content is in this turn so far (or was in this engine session before: it keeps it). */
  outside(): boolean;
  onText(soFar: string): void;
  /** This turn's tokens so far, reported as they grow: a turn that fails or is canceled still shows what it spent. */
  onUsage?(soFar: Usage): void;
  /** Any sign of progress (a token, a tool's result or progress, a status): the turn is still working. */
  alive?(): void;
  /** Runs one APX tool with its card and step record. Every harness calls tools through here. */
  /** `images`: what the tool showed the model to look at with its result (a picture of the screen). */
  execute(
    callId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; text: string; images?: Array<{ media_id: string; mime: string }>; endTurn?: boolean }>;
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
  /** An image an external agent made on its own (Codex's image_gen), shown in this turn's answer. */
  showImage?(file: string): void;
};

export type TurnOutcome = {
  text: string;
  model: string;
  /** The reasoning effort the model ran with, when one was asked for. */
  effort?: string | undefined;
  /** Models tried first that did not answer, with why (each once). */
  failed?: ModelFailure[] | undefined;
  finish?: Finish;
  /** Our loop used every step it had: the answer is the model's account of what is done and left, not a result. */
  outOfSteps?: boolean | undefined;
  sessionId?: string | undefined;
  usage?: Usage | undefined;
  /** The outside session's running total, from an engine that reports only that (Codex): the engine takes the delta. */
  sessionUsage?: Usage | undefined;
};

export type Harness = { id: HarnessId; run(io: TurnIO): Promise<TurnOutcome> };

/** The model part of a ref for a harness that takes one ("claude/claude-opus-5-5" → "claude-opus-5-5"). */
export const modelPart = (ref: string | undefined): string | undefined => (ref ? parseRef(ref).model : undefined);
/** The reasoning effort a ref asks for ("codex/gpt-6-sol#high" → "high"). */
export const effortPart = (ref: string | undefined): string | undefined => (ref ? parseRef(ref).effort : undefined);
