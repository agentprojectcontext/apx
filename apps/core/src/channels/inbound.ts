// What arrives on a channel. Who wrote (an exact address match) decides where the words go: the owner's thread, a
// contact's sealed thread, or a pairing code for a stranger. Button presses decide only when the owner presses them.

import type { Thread } from "@apx/protocol";
import type { Inbound, InboundAction, InboundReaction, OutboxRow, Presentation } from "../domain/channels.ts";
import type { MediaRecord } from "../domain/media.ts";
import type { NewNotification } from "../domain/notifications.ts";
import { OWNER_ID } from "../domain/persons.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { InternalCall } from "../rpc/internal.ts";
import type { Services } from "../services/registry.ts";
import { saveUpload } from "../services/uploads.ts";
import { untrusted } from "../tools/result.ts";
import { asksSomething, needsNoAnswer, reactionFor } from "./closers.ts";
import type { Delivery } from "./delivery.ts";
import { buttonId, parseButton } from "./notices.ts";
import type { createRooms } from "./rooms.ts";
import { channelTexts } from "./texts.ts";
import type { ChannelConfig } from "./types.ts";

/** A contact gets at most this many automatic answers per hour; then the owner is told once. */
const CONTACT_PER_HOUR = 20;
const HOUR_MS = 3600_000;
/** Pairing codes a channel sends to strangers per hour; past it, requests are only listed for the owner. */
const CODES_PER_HOUR = 10;
const LIVE = new Set(["submitted", "working", "input-required"]);

export function createInbound(deps: {
  store: Store;
  home: string;
  log: Log;
  call: InternalCall;
  services: Services;
  delivery: Delivery;
  configs(): ChannelConfig[];
  notifyOwner(body: Presentation, kind?: OutboxRow["kind"], threadId?: string): boolean;
  /** A notice in the app's attention tray. */
  attention(n: NewNotification): void;
  /** The channel is the owner's own account: strangers are listed quietly, never answered. */
  ownAccount(channel: string): boolean;
  /** Messages in the public rooms the owner listed. */
  rooms: ReturnType<typeof createRooms>;
  /** Puts the agent's emoji on a platform message; false when the channel has no reactions or is not running. */
  react(channel: string, conversation: string, ref: string, emoji: string): Promise<boolean>;
}) {
  const { store, log, call, delivery } = deps;
  const recent = new Map<string, number[]>();
  const paused = new Set<string>();
  const codesSent = new Map<string, number[]>();

  /** Stores a one-to-one message (or one in a listed room) and handles it; other groups are never stored nor answered. */
  function receive(channel: string, m: Inbound): void {
    if (!m.private && !m.room) return;
    const id = store.channels.inbox.add(channel, m);
    if (id) queueMicrotask(() => void process({ id, channel, payload: m }));
  }

  async function process(row: { id: string; channel: string; payload: Inbound }): Promise<void> {
    try {
      store.channels.inbox.done(row.id, await route(row.channel, row.id, row.payload));
    } catch (err) {
      const msg = errorMessage(err, 300);
      log.warn({ channel: row.channel, inbox: row.id, err: msg }, "channel message not handled");
      store.channels.inbox.done(row.id, "failed", msg);
      const text = channelTexts(store).notHandled(row.payload.sender.name, msg);
      deps.notifyOwner({ text });
      deps.attention({ kind: "channel", level: "error", title: row.payload.sender.name, body: text });
    }
  }

  async function route(channel: string, rowId: string, m: Inbound): Promise<"done" | "ignored"> {
    const cfg = deps.configs().find((c) => c.id === channel);
    if (!cfg) return "ignored";
    if (!m.private) return m.room ? deps.rooms.handle(cfg, m, rowId) : "ignored";
    const person = store.persons.byAddress(cfg.id, m.sender.id);
    if (!person) return stranger(cfg, m, rowId);
    if (person.role === "blocked") return "ignored";
    const owner = person.role === "owner";
    const thread = owner ? ownerThread(cfg, m.conversation) : contactThread(cfg, m.conversation, person);
    if (!owner && !person.muted && overLimit(person.id, person.name)) return "ignored";
    let text = m.text;
    const attachments: string[] = [];
    let voice: MediaRecord | undefined;
    if (m.voice) {
      try {
        voice = saveUpload(deps.home, store, {
          name: "Voice note",
          mime: m.voice.mime,
          bytes: Buffer.from(m.voice.data, "base64"),
          thread: thread.id,
        });
        attachments.push(voice.id);
      } catch {
        text += "\n[voice note could not be accepted: invalid type, contents or size]";
      }
      if (voice && !(person.muted && !owner)) text = await heard(m, thread.id, voice);
    }
    for (const file of m.files ?? []) {
      try {
        attachments.push(
          saveUpload(deps.home, store, {
            name: file.name,
            mime: file.mime,
            bytes: Buffer.from(file.data, "base64"),
            thread: thread.id,
          }).id,
        );
      } catch {
        text += "\n[attachment could not be accepted: invalid type, contents or size]";
      }
    }
    // A silenced contact keeps its files without transcription, a model call or a work-folder copy.
    if (!owner && person.muted) {
      keepQuiet(thread.id, cfg.id, person, m.voice ? `${text ? `${text}\n` : ""}[voice note]` : text, attachments);
      return "done";
    }
    if (!attachments.length && closesChat(thread.id, text)) {
      const kept = keepQuiet(thread.id, cfg.id, owner ? undefined : person, text.trim());
      theirLast(thread.id, cfg.id, m, kept);
      const emoji = cfg.closers === "react" ? reactionFor(text) : undefined;
      if (emoji && (await deps.react(cfg.id, m.conversation, m.ref ?? m.external_id, emoji).catch(() => false)))
        store.messages.setReaction(kept, "agent", emoji);
      return "done";
    }
    text = text.trim() || (attachments.length ? "[attached files]" : "[empty message]");
    if (
      owner &&
      !m.files?.length &&
      (await answerPending(thread.id, text, rowId, { channel: cfg.id, conversation: m.conversation }))
    )
      return "done";
    const sent = await call(
      "threads.send",
      {
        thread: thread.id,
        text,
        mode: owner ? cfg.concurrency : "queue",
        ...(attachments.length ? { attachments } : {}),
      },
      {
        actor: owner ? "human" : "agent",
        channel: {
          id: cfg.id,
          conversation: m.conversation,
          person_id: person.id,
          name: person.name,
          role: owner ? "owner" : "contact",
        },
      },
      `channel:${rowId}`,
    );
    theirLast(thread.id, cfg.id, m, sent.message.id);
    return "done";
  }

  /** Remembers the other side's last message, so the agent can answer it with a reaction (REACT in manager.ts). */
  function theirLast(threadId: string, channel: string, m: Inbound, messageId: string): void {
    store.threads.mergeContext(threadId, {
      their_last: { channel, conversation: m.conversation, ref: m.ref ?? m.external_id, message_id: messageId },
    });
  }

  /** A voice note as words the agent can read (with its caption, if any); says so when it could not be heard. */
  async function heard(m: Inbound, threadId: string, media: MediaRecord): Promise<string> {
    const voice = m.voice;
    if (!voice) return m.text;
    const caption = m.text ? `${m.text}\n` : "";
    if (!deps.services.hasKind("transcription")) return `${caption}[voice note: no transcription engine is set up]`;
    try {
      const { text } = await deps.services.transcribe(
        { bytes: Buffer.from(voice.data, "base64"), mime: voice.mime, thread: threadId, media },
        AbortSignal.timeout(3 * 60_000),
      );
      return `${caption}[voice note] ${text || "(silence)"}`;
    } catch (err) {
      log.warn({ err: errorMessage(err, 200) }, "voice note not transcribed");
      return `${caption}[voice note: it could not be transcribed]`;
    }
  }

  /**
   * "Ok", "gracias", "no gastes más tokens": nothing to answer, so no model call. Not while a turn is running or
   * waiting for an answer (the words may belong to it), nor when the agent's last words asked something.
   */
  function closesChat(threadId: string, text: string): boolean {
    if (store.inputs.pending(threadId).length) return false;
    if (store.runs.list(threadId, 5).some((r) => LIVE.has(r.state))) return false;
    const last = store.messages
      .list(threadId)
      .findLast((x) => x.author.kind === "agent" || x.author.kind === "person" || x.author.kind === "user");
    const said =
      last?.author.kind === "agent" ? last.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n") : "";
    return needsNoAnswer(text, asksSomething(said));
  }

  /** Each automatic answer to a contact costs a model call: past the hourly limit they wait and the owner hears it. */
  function overLimit(personId: string, name: string): boolean {
    const now = Date.now();
    const times = (recent.get(personId) ?? []).filter((t) => now - t < HOUR_MS);
    times.push(now);
    recent.set(personId, times);
    if (times.length <= CONTACT_PER_HOUR) {
      paused.delete(personId);
      return false;
    }
    if (!paused.has(personId)) {
      paused.add(personId);
      const text = channelTexts(store).tooMany(name);
      deps.notifyOwner({ text });
      deps.attention({ kind: "channel", level: "warn", title: name, body: text });
    }
    return true;
  }

  /** Each pairing code sent counts against its channel's hourly cap; true when this one would go past it. */
  function codesOver(channel: string): boolean {
    const now = Date.now();
    const times = (codesSent.get(channel) ?? []).filter((t) => now - t < HOUR_MS);
    if (times.length >= CODES_PER_HOUR) return true;
    codesSent.set(channel, [...times, now]);
    return false;
  }

  /** Someone with no address on file, handled as the channel says: a code, a question to the owner, an answer, nothing. */
  async function stranger(cfg: ChannelConfig, m: Inbound, rowId: string): Promise<"done" | "ignored"> {
    if (cfg.strangers === "ignore") return "ignored";
    const t = channelTexts(store);
    const name = m.sender.name.slice(0, 80);
    if (cfg.strangers === "answer") {
      store.tx(() => {
        const p = store.persons.create({ name, role: "contact" });
        store.persons.link(p.id, { channel: cfg.id, external_id: m.sender.id, label: name });
      });
      deps.attention({ kind: "channel", title: name, body: t.answering(shown(cfg, name, m.sender.id), cfg.label) });
      return route(cfg.id, rowId, m);
    }
    const { request, fresh } = store.channels.pairing.request({
      channel: cfg.id,
      external_id: m.sender.id,
      conversation: m.conversation,
      name,
      text: m.text,
    });
    // One request per sender until it expires: writing again sends nothing new.
    if (!fresh) return "ignored";
    const decide = (label: string) => [
      { id: buttonId.pairing(request.code, "contact"), label },
      { id: buttonId.pairing(request.code, "deny"), label: t.ignore },
    ];
    if (cfg.strangers === "ask") {
      const text = t.askOwner(shown(cfg, request.name, m.sender.id), cfg.label, (m.text || "").slice(0, 300));
      deps.notifyOwner({ text, buttons: decide(t.answer) }, "pairing");
      deps.attention({ kind: "channel", title: request.name, body: text, ref: pairingRef(request.code) });
      return "ignored";
    }
    // On the owner's own number the request is only listed: the owner's friends must not get a code from it. Past
    // the hourly cap of codes (a wave of spam mail) the rest are only listed too: no reply goes to forged senders.
    if (deps.ownAccount(cfg.id) || codesOver(cfg.id)) return "ignored";
    const agent = store.agents.get(cfg.agent_id)?.name ?? "APX";
    delivery.enqueue({
      channel: cfg.id,
      conversation: m.conversation,
      kind: "pairing",
      body: { text: t.pairing(request.name, agent, request.code, cfg.label) },
    });
    deps.notifyOwner(
      { text: t.pairingOwner(request.name, cfg.label, request.code), buttons: decide(t.asContact) },
      "pairing",
    );
    deps.attention({
      kind: "channel",
      title: request.name,
      body: t.pairingApp(request.name, cfg.label, request.code),
      ref: pairingRef(request.code),
    });
    return "ignored";
  }

  function ownerThread(cfg: ChannelConfig, conversation: string): Thread {
    const home = store.threads.get(HOME_THREAD_ID);
    if (cfg.owner_thread === "home" && home) return home;
    return (
      store.threads.byConversation(cfg.id, conversation) ??
      store.threads.create({
        kind: "channel",
        title: cfg.label,
        agent_ids: [cfg.agent_id],
        channel: { id: cfg.id, conversation, person_id: OWNER_ID },
      })
    );
  }

  function contactThread(cfg: ChannelConfig, conversation: string, person: { id: string; name: string }): Thread {
    return (
      store.threads.byConversation(cfg.id, conversation) ??
      store.threads.create({
        kind: "channel",
        title: person.name,
        agent_ids: [cfg.agent_id],
        channel: { id: cfg.id, conversation, person_id: person.id },
      })
    );
  }

  /**
   * A message that gets no answer (a silenced contact, or a closing "ok"): kept in its chat and in what the agent will
   * read next time. A contact's is marked unread for the owner; `person` is undefined for the owner's own words.
   */
  function keepQuiet(
    threadId: string,
    channel: string,
    person: { id: string; name: string; muted?: boolean } | undefined,
    text: string,
    attachments: string[] = [],
  ): string {
    return store.tx(() => {
      const kept = store.messages.add({
        thread_id: threadId,
        author: person ? { kind: "person", id: person.id, name: person.name, channel } : { kind: "user" },
        parts: [
          { type: "text", text },
          ...attachments.flatMap((id) => {
            const m = store.media.get(id);
            if (!m) return [];
            return [
              m.kind === "image"
                ? { type: "image" as const, media_id: id, mime: m.mime, alt: m.prompt ?? "image" }
                : m.kind === "audio"
                  ? { type: "audio" as const, media_id: id, mime: m.mime }
                  : { type: "file" as const, media_id: id, mime: m.mime, name: m.prompt ?? id, bytes: m.bytes },
            ];
          }),
        ],
      });
      const why: Record<string, string> = person?.muted ? { silenced: "yes" } : { answered: "no, it needed no answer" };
      store.modelLog.append(threadId, undefined, [
        {
          role: "user",
          content: person ? untrusted("channel_message", { from: person.name, channel, ...why }, text) : text,
          images: attachments.flatMap((id) => {
            const m = store.media.get(id);
            return m?.kind === "image" ? [{ media_id: id, mime: m.mime }] : [];
          }),
        },
      ]);
      const t = store.threads.get(threadId);
      store.threads.patch(threadId, { preview: previewOf(text), ...(person ? { unread: (t?.unread ?? 0) + 1 } : {}) });
      return kept.id;
    });
  }

  /**
   * Someone put an emoji on one of the messages sent on this channel (or took theirs off): shown on it in the app.
   * Never a turn: a reaction needs no answer and costs nothing. Only from someone known, in a one-to-one chat.
   */
  function reaction(channel: string, r: InboundReaction): void {
    if (!r.private) return;
    const person = store.persons.byAddress(channel, r.sender.id);
    if (!person || person.role === "blocked") return;
    const sent = store.channels.outbox.byExternal(channel, r.target);
    if (sent?.message_id && sent.conversation === r.conversation)
      store.messages.setReaction(sent.message_id, "them", r.emoji);
  }

  /** The owner's text answers an open question of that thread, when one is waiting for words. */
  async function answerPending(
    threadId: string,
    words: string,
    rowId: string,
    to: { channel: string; conversation: string },
  ): Promise<boolean> {
    const open = store.inputs.pending(threadId).find((i) => i.kind === "question");
    if (!open) return false;
    store.threads.mergeContext(threadId, { reply_to: to });
    store.runs.setReplyTo(open.run_id, to);
    await call("runs.respond", { input: open.id, text: words }, { actor: "human" }, `channel:${rowId}:respond`);
    return true;
  }

  /** A button press. Only the owner's own address decides; the turn it unblocks answers back on this channel. */
  async function action(channel: string, a: InboundAction): Promise<void> {
    if (store.persons.byAddress(channel, a.sender.id)?.role !== "owner") return;
    const t = channelTexts(store);
    const reply = (text: string) =>
      delivery.enqueue({ channel, conversation: a.conversation, kind: "notice", body: { text } });
    const button = parseButton(a.data);
    if (!button) return;
    try {
      if (button.kind === "pairing") {
        await call("pairing.respond", { code: button.code, decision: button.decision }, { actor: "human" });
        reply(button.decision === "contact" ? t.approved : t.denied);
        return;
      }
      if (button.kind === "feedback") {
        await call("notices.feedback", { id: button.nudgeId, feedback: button.feedback }, { actor: "human" });
        reply(t.rated);
        return;
      }
      const input = store.inputs.get(button.inputId);
      if (input?.state !== "pending") return;
      store.threads.mergeContext(input.thread_id, { reply_to: { channel, conversation: a.conversation } });
      store.runs.setReplyTo(input.run_id, { channel, conversation: a.conversation });
      if (button.kind === "input") {
        await call("runs.respond", { input: input.id, decision: button.answer }, { actor: "human" });
        reply(button.answer === "approve" ? t.approved : t.denied);
      } else {
        const choice = input.options?.[button.index];
        if (choice === undefined) return;
        await call("runs.respond", { input: input.id, text: choice }, { actor: "human" });
        reply(t.answered(choice));
      }
    } catch (err) {
      const msg = errorMessage(err, 200);
      log.warn({ channel, err: msg }, "channel button not handled");
      reply(t.buttonFailed(msg));
    }
  }

  return {
    receive,
    action,
    reaction,
    /**
     * A request the owner approved after being asked: its first message is handled now, as if it had just arrived from
     * the person it turned out to be.
     */
    approved(req: {
      code: string;
      channel: string;
      external_id: string;
      conversation: string;
      name: string;
      text?: string | undefined;
    }): void {
      if (deps.configs().find((c) => c.id === req.channel)?.strangers !== "ask" || !req.text) return;
      receive(req.channel, {
        external_id: `pairing:${req.code}`,
        conversation: req.conversation,
        sender: { id: req.external_id, name: req.name },
        text: req.text,
        private: true,
      });
    },
    /** Boot: messages stored but not handled before a restart. */
    resume(): void {
      for (const row of store.channels.inbox.pending()) void process(row);
    },
  };
}

/** A name with its phone number when the channel has one (a stranger picks their own name; the number is theirs). */
function shown(cfg: ChannelConfig, name: string, externalId: string): string {
  const phone = cfg.type === "whatsapp" ? /^(\d{6,})@s\.whatsapp\.net$/.exec(externalId)?.[1] : undefined;
  return phone ? `${name} (+${phone})` : name;
}

/** The tray notice of a pairing request, closed when the owner answers it. */
export const pairingRef = (code: string) => `pairing:${code}`;
