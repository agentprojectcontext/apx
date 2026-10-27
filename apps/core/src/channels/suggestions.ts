// A supervised contact is never answered on its own. Once a burst of their messages settles, the agent drafts the reply
// it would send (engine/suggest.ts) and the owner gets who wrote, what they said and the draft, to send it, answer
// them themselves or drop it. The same choices are methods (contacts.suggestions.*) for any client.
// See DECISIONS.md#d-088
import type { ContactSuggestion, Thread } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { publicSuggestion } from "../domain/suggestions.ts";
import { isSkip } from "../engine/routines.ts";
import type { Draft } from "../engine/suggest.ts";
import { badRequest, conflict, errorMessage, notFound } from "../errors.ts";
import type { Log } from "../log.ts";
import { reactAnswer } from "./closers.ts";
import { guardReply } from "./guard.ts";
import { buttonId, shown } from "./notices.ts";
import type { TellOwner } from "./owner-notices.ts";
import type { createPoster } from "./post.ts";
import { channelTexts } from "./texts.ts";
import type { ChannelConfig } from "./types.ts";

/** How long a contact's quick messages may keep coming before one draft answers them all. */
const BURST_MS = 15_000;
/** Drafts per contact per hour: each one is a model call. */
const DRAFTS_PER_HOUR = 10;
const HOUR_MS = 3600_000;
/** After "I'll answer", how long the owner's next message on that chat is taken as their answer. */
const WRITE_MINUTES = 10;
/** Their latest messages a draft answers and the notice shows. */
const SAID_MAX = 10;
const LINE_CHARS = 500;
const DRAFT_CHARS = 2500;

export const suggestionRef = (id: string) => `suggestion:${id}`;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function createSuggestions(deps: {
  store: Store;
  log: Log;
  tell: TellOwner;
  /** The agent's draft for a chat; none: every notice says no draft could be written. */
  draft?: ((threadId: string, agentId: string, signal?: AbortSignal) => Promise<Draft>) | undefined;
  post: ReturnType<typeof createPoster>["post"];
  /** The owner's own words to a contact, kept and sent as theirs. */
  sendAsOwner(threadId: string, text: string): { outbox: string; message_id: string } | undefined;
  burstMs?: number | undefined;
}) {
  const { store, log } = deps;
  const burstMs = deps.burstMs ?? BURST_MS;
  const ac = new AbortController();
  /** Per chat: the burst waiting to settle, and the draft being written (the next one waits for it). */
  const bursts = new Map<string, ReturnType<typeof setTimeout>>();
  const drafting = new Map<string, Promise<void>>();
  const drafted = new Map<string, number[]>();
  const capped = new Set<string>();
  /** The owner's chats where their next words answer a contact: by channel and conversation. */
  const writing = new Map<string, { id: string; until: number }>();
  const writeKey = (channel: string, conversation: string) => `${channel}\n${conversation}`;

  /** A supervised contact's message was kept: their draft comes once their burst settles. */
  function held(cfg: ChannelConfig, person: { id: string; name: string }, senderId: string, threadId: string): void {
    if (ac.signal.aborted) return;
    clearTimeout(bursts.get(threadId));
    const timer = setTimeout(() => {
      bursts.delete(threadId);
      const before = drafting.get(threadId) ?? Promise.resolve();
      const next = before
        .then(() => suggest(cfg, person, senderId, threadId))
        .catch((err: unknown) => log.warn({ thread: threadId, err: errorMessage(err, 200) }, "no suggestion made"))
        .finally(() => {
          if (drafting.get(threadId) === next) drafting.delete(threadId);
        });
      drafting.set(threadId, next);
    }, burstMs);
    timer.unref?.();
    bursts.set(threadId, timer);
  }

  /**
   * Their messages since anyone last answered them or the owner last dropped a draft for them, oldest first (none:
   * they were answered meanwhile).
   */
  function unanswered(threadId: string): string[] {
    const out: string[] = [];
    const dealt = store.suggestions.lastDecided(threadId) ?? "";
    for (const m of store.messages.list(threadId, 40).reverse()) {
      if (m.author.kind === "agent" || m.author.kind === "user" || m.created_at <= dealt) break;
      if (m.author.kind !== "person") continue;
      const said = m.parts
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("\n")
        .trim();
      if (said) out.unshift(said);
      if (out.length >= SAID_MAX) break;
    }
    return out;
  }

  /** Each draft costs a model call: past the hourly cap their messages are only kept, and the owner hears it once. */
  function overCap(person: { id: string; name: string }): boolean {
    const at = Date.now();
    const times = (drafted.get(person.id) ?? []).filter((x) => at - x < HOUR_MS);
    if (times.length >= DRAFTS_PER_HOUR) {
      drafted.set(person.id, times);
      if (!capped.has(person.id)) {
        capped.add(person.id);
        const text = channelTexts(store).tooManyDrafts(person.name);
        deps.tell({ text }, { level: "warn", title: person.name });
      }
      return true;
    }
    capped.delete(person.id);
    drafted.set(person.id, [...times, at]);
    return false;
  }

  async function suggest(
    cfg: ChannelConfig,
    person: { id: string; name: string },
    senderId: string,
    threadId: string,
  ): Promise<void> {
    if (!unanswered(threadId).length || overCap(person)) return;
    const thread = store.threads.get(threadId);
    if (!thread) return;
    const agentId = thread.agent_ids[0] ?? cfg.agent_id;
    const t = channelTexts(store);
    let text = "";
    let error: string | undefined;
    let model: string | undefined;
    if (!deps.draft) error = "no model to draft with";
    else {
      try {
        const d = await deps.draft(threadId, agentId, ac.signal);
        model = d.model;
        text = guardReply(d.text).trim();
        // A turn's signals (SKIP, REACT ❤️) are not words to send.
        if (!text || isSkip(text) || reactAnswer(text)) {
          text = "";
          error = t.nothingToAnswer;
        }
      } catch (err) {
        error = errorMessage(err, 200);
      }
    }
    // Stopping, or someone answered them while the draft was written: it would answer what was already answered.
    const said = unanswered(threadId);
    if (ac.signal.aborted || !said.length) return;
    const s = store.tx(() => {
      for (const old of store.suggestions.pendingIn(threadId)) {
        store.suggestions.decide(old.id, "superseded");
        store.notifications.resolve("channel", suggestionRef(old.id));
      }
      return store.suggestions.add({
        person_id: person.id,
        thread_id: threadId,
        channel: cfg.id,
        agent_id: agentId,
        said,
        text,
        error,
        model,
      });
    });
    present(cfg, person, senderId, s);
  }

  /** The notice: who wrote, all they said, and the draft with its three choices (two when there is no draft). */
  function present(
    cfg: ChannelConfig,
    person: { id: string; name: string },
    senderId: string,
    s: ContactSuggestion,
  ): void {
    const t = channelTexts(store);
    const who = shown(cfg, person.name, senderId);
    const said = s.said.map((x) => t.quote(clip(x, LINE_CHARS))).join("\n");
    const text = s.text
      ? t.suggested(who, cfg.label, said, clip(s.text, DRAFT_CHARS))
      : t.noSuggestion(who, cfg.label, said, s.error ?? "");
    const buttons = [
      ...(s.text ? [{ id: buttonId.suggestion(s.id, "send"), label: t.sendThis }] : []),
      { id: buttonId.suggestion(s.id, "write"), label: t.writeMyself },
      { id: buttonId.suggestion(s.id, "ignore"), label: t.ignore },
    ];
    deps.tell({ text, buttons }, { title: person.name, thread_id: s.thread_id, ref: suggestionRef(s.id) }, "input");
  }

  function pending(id: string) {
    const s = store.suggestions.get(id);
    if (!s) throw notFound(`suggestion ${id}`);
    if (s.state !== "pending") throw conflict(`suggestion ${id} is ${s.state}`);
    return s;
  }

  /** The decision is made: its notice leaves the tray, and an "I'll answer" waiting on it is over. */
  function closed(id: string): void {
    store.notifications.resolve("channel", suggestionRef(id));
    for (const [k, w] of writing) if (w.id === id) writing.delete(k);
  }

  /**
   * Sends a pending draft in the contact's chat: as the agent's reply (kept in what it reads next), or with
   * `author: "owner"` as the owner's own words. `text` replaces the draft.
   */
  function send(
    id: string,
    o: { text?: string | undefined; author?: "agent" | "owner" | undefined },
  ): { suggestion: ContactSuggestion; outbox: string } {
    const s = pending(id);
    const words = o.text?.trim() || s.text;
    if (!words) throw badRequest("this suggestion has no draft: send a text");
    const thread: Thread | undefined = store.threads.get(s.thread_id);
    const ch = thread?.channel;
    if (!thread || !ch) throw notFound(`thread ${s.thread_id}`);
    let outbox: string;
    let messageId: string | undefined;
    if (o.author === "owner") {
      const sent = deps.sendAsOwner(thread.id, words);
      if (!sent) throw badRequest("only a contact's chat takes the owner's words here");
      outbox = sent.outbox;
      messageId = sent.message_id;
    } else {
      outbox = deps.post(thread, ch.id, ch.conversation, words, { by: s.agent_id, logged: true });
      messageId = store.channels.outbox.get(outbox)?.message_id;
    }
    const done = store.suggestions.decide(id, "sent", messageId) ?? s;
    closed(id);
    return { suggestion: publicSuggestion(done), outbox };
  }

  function discard(id: string): ContactSuggestion {
    pending(id);
    const done = store.suggestions.decide(id, "discarded");
    if (!done) throw conflict(`suggestion ${id} is no longer pending`);
    closed(id);
    return publicSuggestion(done);
  }

  return {
    held,
    send,
    discard,
    /** "I'll answer": the owner's next words on this chat of theirs go to the contact. */
    write(id: string, channel: string, conversation: string): { name: string; minutes: number } {
      const s = pending(id);
      writing.set(writeKey(channel, conversation), { id, until: Date.now() + WRITE_MINUTES * 60_000 });
      return { name: store.persons.get(s.person_id)?.name ?? "", minutes: WRITE_MINUTES };
    },
    /** Takes the "I'll answer" waiting on the owner's chat, if one is still on: their words are its answer. */
    takeWriting(channel: string, conversation: string): string | undefined {
      const key = writeKey(channel, conversation);
      const w = writing.get(key);
      writing.delete(key);
      return w && w.until > Date.now() ? w.id : undefined;
    },
    stop(): void {
      ac.abort();
      for (const t of bursts.values()) clearTimeout(t);
      bursts.clear();
      writing.clear();
    },
  };
}

export type Suggestions = ReturnType<typeof createSuggestions>;
