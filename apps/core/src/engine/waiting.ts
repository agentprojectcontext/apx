// The owner's words written while their agent works (DECISIONS.md#d-185): sent ones its running turn takes at the
// next step, and the ones they put in line, which wait for that turn to end and can be edited, removed or moved first.

import type { Message } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, notFound } from "../errors.ts";

/** The owner's message a run of theirs answers, when it came from the app. */
export const askedIn = (run: RunRecord | undefined): string | undefined =>
  run?.trigger === "user" && run.input?.origin.kind === "user" ? run.input.origin.message_id : undefined;

/** A message in line and its turn, still unstarted; anything else is refused with why. */
function inLine(store: Store, runId: string): { run: RunRecord; message: Message } {
  const run = store.runs.get(runId);
  if (!run) throw notFound(`run ${runId}`);
  const id = askedIn(run);
  const message = id ? store.messages.get(id) : undefined;
  if (!message) throw badRequest("only your own messages in line can be changed");
  if (message.waiting?.until !== "turn" || run.state !== "submitted")
    throw conflict("its turn already started: it can no longer be changed");
  return { run, message };
}

/** The thread's messages in line, in the order their turns will start. */
export function lineOf(store: Store, threadId: string): Array<{ run: RunRecord; message: Message }> {
  return store.messages
    .waitingIn(threadId)
    .flatMap((message) => {
      const run = message.waiting?.until === "turn" ? store.runs.get(message.waiting.run ?? "") : undefined;
      return run?.state === "submitted" ? [{ run, message }] : [];
    })
    .sort((a, b) => a.message.seq - b.message.seq);
}

export function editInLine(store: Store, runId: string, text: string): Message {
  return store.tx(() => {
    const { run, message } = inLine(store, runId);
    store.runs.setText(run.id, text);
    const first = message.parts.findIndex((p) => p.type === "text");
    const parts = message.parts.map((p, i) => (i === first ? { type: "text" as const, text } : p));
    return store.messages.update({ ...message, parts: first < 0 ? [{ type: "text", text }, ...parts] : parts });
  });
}

/** Out of the line and out of the chat: the turn ends canceled before it started. */
export function removeFromLine(store: Store, runId: string, ended: (run: RunRecord) => void): void {
  store.tx(() => {
    const { run, message } = inLine(store, runId);
    ended(store.runs.setState(run, "canceled", "removed before it started", { reason: "canceled" }));
    store.messages.drop(message.thread_id, [message.id]);
  });
}

/** `runs`: every message in line in the thread, each once, in the order they should run. */
export function reorderLine(store: Store, threadId: string, runs: readonly string[]): Message[] {
  return store.tx(() => {
    const line = lineOf(store, threadId);
    const known = new Set(line.map((l) => l.run.id));
    if (runs.length !== known.size || new Set(runs).size !== runs.length || runs.some((id) => !known.has(id)))
      throw conflict("the messages in line changed; refresh and try again");
    const byRun = new Map(line.map((l) => [l.run.id, l.message]));
    const seats = line.map((l) => l.message.seq);
    store.runs.reorder(runs);
    return store.messages.reseat(
      threadId,
      runs.map((id, i) => ({ id: byRun.get(id)?.id ?? "", seq: seats[i] ?? 0 })),
    );
  });
}
