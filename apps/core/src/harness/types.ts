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
  signal: AbortSignal;
  /** The external harness's own conversation id for this thread, when there is one. */
  sessionId: string | undefined;
  onText(soFar: string): void;
  /** Runs one APX tool with its card and step record. Every harness calls tools through here. */
  execute(callId: string, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  /** Appends items to what the model saw in this turn (native writes as it goes, so a crash keeps them). */
  log(items: ChatItem[]): void;
};

export type TurnOutcome = {
  text: string;
  model: string;
  finish?: Finish;
  sessionId?: string | undefined;
  usage?: Usage | undefined;
};

export type Harness = { id: HarnessId; run(io: TurnIO): Promise<TurnOutcome> };
