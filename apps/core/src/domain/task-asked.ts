// The owner's own words behind a task. An agent that creates or changes a task while answering the owner passes on
// what they said as written, so whoever works it reads the request itself, not only that agent's brief.
// See DECISIONS.md#d-185.
import type { TaskAsked } from "@apx/protocol";
import { ownerOrigin } from "./runs.ts";
import type { Store } from "./store.ts";

/** How far back the owner's earlier messages in the same chat still belong to the request ("this repo" above). */
const BEFORE_MS = 10 * 60_000;
const BEFORE_KEPT = 2;

const textOf = (parts: { type: string; text?: string }[]) =>
  parts
    .flatMap((p) => (p.type === "text" && p.text ? [p.text] : []))
    .join("\n")
    .trim();

/**
 * What the owner said in the turn `runId` answers: their message, and up to two they sent just before it in that chat.
 * Nothing when no message of the owner started the turn: a contact, a routine, another agent, or the work APX starts
 * on a task the owner gave (its input is the task, not their words).
 */
export function ownerWordsOf(store: Store, runId: string): TaskAsked[] {
  const run = store.runs.get(runId);
  const origin = run?.input?.origin;
  if (!run || !ownerOrigin(origin)) return [];
  const by = run.agent_id;
  const id = "message_id" in origin && typeof origin.message_id === "string" ? origin.message_id : undefined;
  const message = id ? store.messages.get(id) : undefined;
  if (message?.author.kind !== "user") return [];
  // A voice note's words are in the turn's input, not in the message's text parts.
  const said = (run.input?.text ?? "").trim();
  const since = Date.parse(message.created_at) - BEFORE_MS;
  const before = store.messages
    .around(message.thread_id, message.seq, 12)
    .filter((m) => m.seq < message.seq && m.author.kind === "user" && Date.parse(m.created_at) >= since)
    .slice(-BEFORE_KEPT);
  return [...before, message].flatMap((m) => {
    const text = m.id === message.id && said ? said : textOf(m.parts);
    return text ? [{ text, at: m.created_at, by, message_id: m.id }] : [];
  });
}
