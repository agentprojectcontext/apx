// A room's turn has no tools (D-041). When the owner asks there for something that needs them, the room's agent says it
// is on its way and ends its answer with HANDOFF: APX takes that line out of what is posted and hands the owner's own
// message (never the model's words, never a member's) to Home, where it gets done and answered in private.
// See DECISIONS.md#d-213
import { ownerActsOn } from "../domain/channels.ts";
import type { RunRecord } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { inlineName } from "../tools/result.ts";
import type { AdmitFn } from "./engine.ts";
import { relayOwnerWords } from "./owner-relay.ts";

/** The room answer without its last line when that line is HANDOFF (markdown and a full stop allowed), else undefined. */
export function handoffAnswer(text: string): string | undefined {
  const lines = text.trimEnd().split("\n");
  const last = (lines.at(-1) ?? "").replace(/[\s*_`.!:]/g, "").toUpperCase();
  if (last !== "HANDOFF") return undefined;
  return lines.slice(0, -1).join("\n").trim();
}

const ON_ITS_WAY: Record<string, string> = {
  es: "Dale, me ocupo y te aviso por privado.",
  en: "On it: I'll get back to you in private.",
};

/** What a room's agent wrote a HANDOFF for, once its turn ended: the line goes, and the owner's message moves on. */
export function roomHandoff(store: Store, admit: AdmitFn, log: Log, run: RunRecord): void {
  if (run.state !== "completed" || !run.message_id) return;
  const room = store.threads.context(run.thread_id).room;
  const msg = store.messages.get(run.message_id);
  if (!room || !msg) return;
  const said = msg.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
  const rest = handoffAnswer(said);
  if (rest === undefined) return;
  const origin = run.input?.origin;
  // Only the owner's own message in the room, checked by account; from anyone else the line just goes.
  const owner = origin?.kind === "channel" && origin.role === "owner" ? origin : undefined;
  const lang = store.settings.get("owner_language") || "es";
  const text = rest || (owner ? (ON_ITS_WAY[lang] ?? ON_ITS_WAY.en) : "");
  const others = msg.parts.filter((p) => p.type !== "text");
  store.messages.update({ ...msg, parts: text ? [{ type: "text", text }, ...others] : others });
  const home = store.threads.get(HOME_THREAD_ID);
  const agent = home ? store.agents.get(home.agent_ids[0] ?? "") : undefined;
  if (!owner || !run.input || !agent) return;
  try {
    const words = [...burstBefore(store, run.thread_id, owner.message_id), run.input.text].join("\n").slice(-4000);
    handOn(store, admit, { owner, words, room: room.name, agentId: agent.id });
  } catch (err) {
    // The room's answer still goes out; what failed is told in the log, never in the room.
    log.warn({ run: run.id, err: errorMessage(err, 200) }, "room request not handed to Home");
  }
}

/** Longest pause between two of one person's quick messages that a room answers as one (rooms.ts waits 8 s). */
const BURST_GAP_MS = 15_000;

/**
 * The owner's own messages a burst kept unanswered right before the one answered, oldest first: theirs alone, with
 * nobody else's message (nor an answer) between them, each close to the next.
 */
function burstBefore(store: Store, threadId: string, messageId: string | undefined): string[] {
  const all = store.messages.list(threadId);
  let at = all.findIndex((m) => m.id === messageId);
  const kept: string[] = [];
  while (at > 0) {
    const m = all[at - 1];
    const next = all[at];
    if (!m || !next || m.author.kind !== "user" || !m.author.direct) break;
    if (Date.parse(next.created_at) - Date.parse(m.created_at) > BURST_GAP_MS) break;
    const text = m.parts
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("\n")
      .trim();
    if (text) kept.unshift(text);
    at--;
  }
  return kept;
}

type ChannelOrigin = Extract<NonNullable<RunRecord["input"]>["origin"], { kind: "channel" }>;

function handOn(
  store: Store,
  admit: AdmitFn,
  o: { owner: ChannelOrigin; words: string; room: string; agentId: string },
) {
  const { owner, words } = o;
  const agent = store.agents.get(o.agentId);
  if (!agent) return;
  const cfg = store.settings.read("channels").find((c) => c.id === owner.channel);
  const label = inlineName(cfg?.label ?? owner.channel);
  const where = `#${inlineName(o.room)} (a public room on ${label})`;
  // Answers go where the owner hears from Home, never back to the room.
  const reply_to = store.threads.context(HOME_THREAD_ID).reply_to;
  const channel = { id: owner.channel, conversation: owner.conversation, person_id: owner.person_id, name: owner.name };
  if (!ownerActsOn(cfg?.type)) {
    // As the owner's words on that channel anywhere else: the super-agent checks them first (DECISIONS.md#d-144).
    relayOwnerWords(store, admit, {
      threadId: HOME_THREAD_ID,
      agent,
      channel,
      text: words,
      attachments: [],
      room: { where, ...(reply_to ? { reply_to } : {}) },
    });
    return;
  }
  store.tx(() => {
    const message = store.messages.add({
      thread_id: HOME_THREAD_ID,
      author: { kind: "user" },
      via: owner.channel,
      parts: [{ type: "text", text: words }],
    });
    store.threads.patch(HOME_THREAD_ID, { preview: previewOf(words) });
    admit({
      thread_id: HOME_THREAD_ID,
      agent_id: agent.id,
      trigger: "user",
      origin: { kind: "user", message_id: message.id },
      text: [
        `Your owner wrote this in ${where}, where they were told it is on its way and they will hear back in private:`,
        words,
        "Do it here. Your answer reaches them privately, never in that room unless they ask you to post there.",
      ].join("\n\n"),
    });
  });
}
