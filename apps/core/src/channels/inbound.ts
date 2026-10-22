// What arrives on a channel. Who wrote (an exact address match) decides where the words go: the owner's thread, a
// contact's sealed thread, or a pairing code for a stranger. Button presses decide only when the owner presses them.

import { type Thread, UPLOAD_LIMITS } from "@apx/protocol";
import type { Inbound, InboundAction, InboundReaction, OutboxRow, Presentation } from "../domain/channels.ts";
import { type MediaRecord, partOfMedia } from "../domain/media.ts";
import type { NewNotification } from "../domain/notifications.ts";
import { OWNER_ID } from "../domain/persons.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { newsAction } from "../news/entries.ts";
import type { InternalCall } from "../rpc/internal.ts";
import type { Services } from "../services/registry.ts";
import { saveUpload } from "../services/uploads.ts";
import { untrusted } from "../tools/result.ts";
import { asksSomething, asksToStop, needsNoAnswer, reactionFor } from "./closers.ts";
import type { Delivery } from "./delivery.ts";
import { type Button, buttonId, inputPresentation, parseButton, ratingOf, shown } from "./notices.ts";
import type { createRooms } from "./rooms.ts";
import type { Suggestions } from "./suggestions.ts";
import { channelTexts } from "./texts.ts";
import type { ChannelConfig } from "./types.ts";

/** A contact gets at most this many automatic answers per hour; then the owner is told once. */
const CONTACT_PER_HOUR = 20;
const HOUR_MS = 3600_000;
/** Pairing codes a channel sends to strangers per hour; past it, requests are only listed for the owner. */
const CODES_PER_HOUR = 10;
/** Reports of one unreviewed contact's messages per hour; past it their messages are only kept. */
const REPORTS_PER_HOUR = 10;
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
  /** Drafts for supervised contacts, and the owner answering one of them in their own words. */
  suggestions: Pick<Suggestions, "held" | "write" | "takeWriting">;
  /** Puts the agent's emoji on a platform message; false when the channel has no reactions or is not running. */
  react(channel: string, conversation: string, ref: string, emoji: string): Promise<boolean>;
  /** The owner answers an input from this chat: its message there is not taken out when it settles. */
  answeredHere(inputId: string, at: { channel: string; conversation: string }, by: "button" | "text"): void;
  /** Replaces the buttons under a message sent on a channel; false when the channel cannot. */
  setButtons(channel: string, conversation: string, ref: string, buttons: Presentation["buttons"]): Promise<boolean>;
  /** The owner's words kept without a turn (a closing "genial, funcionó"): memory may still learn from them. */
  ownerReplied?: (messageId: string) => void;
}) {
  const { store, log, call, delivery } = deps;
  const recent = new Map<string, number[]>();
  const paused = new Set<string>();
  const codesSent = new Map<string, number[]>();
  const reports = new Map<string, number[]>();
  /** The options ticked so far on a multi-choice question, by input. */
  const ticked = new Map<string, Set<number>>();

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
    if (m.action) {
      await action(channel, { conversation: m.conversation, sender: m.sender, data: m.action });
      return "done";
    }
    const person = store.persons.byAddress(cfg.id, m.sender.id);
    if (!person) return stranger(cfg, m, rowId);
    if (person.role === "blocked") return "ignored";
    const owner = person.role === "owner";
    const thread = owner ? ownerThread(cfg, m.conversation) : contactThread(cfg, m.conversation, person);
    // A supervised contact costs a draft, not an answer: suggestions.ts keeps its own hourly cap.
    const supervised = !owner && !person.muted && person.supervised;
    if (!owner && !person.muted && !supervised && overLimit(person.id, person.name)) return "ignored";
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
          saveUpload(
            deps.home,
            store,
            { name: file.name, mime: file.mime, bytes: Buffer.from(file.data, "base64"), thread: thread.id },
            // Videos and documents are kept to play or download; a picture stays small enough for a model to see.
            file.mime.startsWith("image/") ? undefined : UPLOAD_LIMITS.channelBytes,
          ).id,
        );
      } catch (err) {
        text += `\n[attachment could not be accepted: ${errorMessage(err, 200)}]`;
      }
    }
    // A silenced contact keeps its files without transcription, a model call or a work-folder copy.
    if (!owner && person.muted) {
      const said = m.voice ? `${text ? `${text}\n` : ""}[voice note]` : text;
      keepQuiet(thread.id, cfg.id, person, said, attachments);
      if (person.unreviewed) report(cfg, person, m.sender.id, said, thread.id);
      return "done";
    }
    // Supervised: kept unanswered, and the owner gets the reply the agent would send (a closing "ok" gets none).
    if (supervised) {
      const said = text.trim() || (attachments.length ? "[attached files]" : "[empty message]");
      const closes = !attachments.length && closesChat(thread.id, said);
      theirLast(thread.id, cfg.id, m, keepQuiet(thread.id, cfg.id, person, said, attachments, {}));
      if (!closes) deps.suggestions.held(cfg, person, m.sender.id, thread.id);
      return "done";
    }
    // After "I'll answer" on a draft, even an "ok" is the owner's answer to that contact.
    if (
      owner &&
      !attachments.length &&
      !m.voice &&
      text.trim() &&
      (await answerContact(cfg.id, m.conversation, text.trim(), rowId))
    )
      return "done";
    if (!attachments.length && closesChat(thread.id, text)) {
      const kept = keepQuiet(thread.id, cfg.id, owner ? undefined : person, text.trim());
      if (owner) deps.ownerReplied?.(kept);
      theirLast(thread.id, cfg.id, m, kept);
      const emoji = cfg.closers === "react" ? reactionFor(text) : undefined;
      if (emoji && (await deps.react(cfg.id, m.conversation, m.ref ?? m.external_id, emoji).catch(() => false)))
        store.messages.setReaction(kept, "agent", emoji);
      return "done";
    }
    text = text.trim() || (attachments.length ? "[attached files]" : "[empty message]");
    // "Pará" while the agent works: the turn stops, and the word is kept without starting another.
    if (owner && !attachments.length && asksToStop(text) && working(thread.id)) {
      await call("threads.cancel", { thread: thread.id }, { actor: "human" }, `channel:${rowId}:stop`);
      theirLast(thread.id, cfg.id, m, keepQuiet(thread.id, cfg.id, undefined, text));
      delivery.enqueue({
        channel: cfg.id,
        conversation: m.conversation,
        thread_id: thread.id,
        kind: "notice",
        body: { text: channelTexts(store).stopped },
      });
      return "done";
    }
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

  /** Tells the owner what an unreviewed contact wrote, with the choice to answer them or stop the reports. */
  function report(
    cfg: ChannelConfig,
    person: { id: string; name: string },
    senderId: string,
    said: string,
    threadId: string,
  ): void {
    const at = Date.now();
    const times = (reports.get(person.id) ?? []).filter((x) => at - x < HOUR_MS);
    if (times.length >= REPORTS_PER_HOUR) return;
    reports.set(person.id, [...times, at]);
    const t = channelTexts(store);
    const text = t.wroteFirst(shown(cfg, person.name, senderId), cfg.label, said.slice(0, 300));
    const buttons = [
      { id: buttonId.review(person.id, "answer"), label: t.answer },
      { id: buttonId.review(person.id, "ignore"), label: t.ignore },
    ];
    deps.notifyOwner({ text, buttons }, "pairing", threadId);
    deps.attention({ kind: "channel", title: person.name, body: text, thread_id: threadId });
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
    if (working(threadId)) return false;
    const last = store.messages
      .list(threadId)
      .findLast((x) => x.author.kind === "agent" || x.author.kind === "person" || x.author.kind === "user");
    const said =
      last?.author.kind === "agent" ? last.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n") : "";
    return needsNoAnswer(text, asksSomething(said));
  }

  /** A turn of the thread is running, queued or waiting for an answer. */
  function working(threadId: string): boolean {
    return store.runs.list(threadId, 5).some((r) => LIVE.has(r.state));
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
    // Asked: kept as a silenced contact the owner has not reviewed. Their words show in their chat, unanswered, and
    // each message is reported to the owner, who can turn on answers.
    if (cfg.strangers === "ask") {
      store.tx(() => {
        const p = store.persons.create({ name, role: "contact", unreviewed: true });
        store.persons.link(p.id, { channel: cfg.id, external_id: m.sender.id, label: name });
      });
      return route(cfg.id, rowId, m);
    }
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
    /** What the agent reads about why it was not answered; by default, silenced or needing no answer. */
    note?: Record<string, string>,
  ): string {
    return store.tx(() => {
      const kept = store.messages.add({
        thread_id: threadId,
        author: person ? { kind: "person", id: person.id, name: person.name, channel } : { kind: "user" },
        parts: [
          { type: "text", text },
          ...attachments.flatMap((id) => {
            const m = store.media.get(id);
            return m ? [partOfMedia(m)] : [];
          }),
        ],
      });
      const why: Record<string, string> =
        note ?? (person?.muted ? { silenced: "yes" } : { answered: "no, it needed no answer" });
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
   * Never a turn: a reaction needs no answer and costs nothing. Only from someone known, in a one-to-one chat. The
   * owner's 👍/👎 on a routine's or an agent's news rates it.
   */
  function reaction(channel: string, r: InboundReaction): void {
    if (!r.private) return;
    const person = store.persons.byAddress(channel, r.sender.id);
    if (!person || person.role === "blocked") return;
    const sent = store.channels.outbox.byExternal(channel, r.target);
    if (!sent || sent.conversation !== r.conversation) return;
    if (sent.message_id) store.messages.setReaction(sent.message_id, "them", r.emoji);
    const feedback = ratingOf(r.emoji);
    if (person.role === "owner" && sent.body.rate && feedback !== undefined)
      void call("notices.feedback", { id: sent.body.rate, feedback }, { actor: "human" }).catch((err: unknown) =>
        log.warn({ channel, err: errorMessage(err, 200) }, "rating not kept"),
      );
  }

  /**
   * The owner pressed "I'll answer" on a supervised contact's draft: their next words on this chat go to the contact
   * as theirs ("cancelar" sends nothing). A draft replaced meanwhile still takes them, as the owner's direct words.
   */
  async function answerContact(channel: string, conversation: string, words: string, rowId: string): Promise<boolean> {
    const id = deps.suggestions.takeWriting(channel, conversation);
    if (!id) return false;
    const t = channelTexts(store);
    const reply = (text: string) => delivery.enqueue({ channel, conversation, kind: "notice", body: { text } });
    if (/^(cancel|cancelar|cancelá)\W*$/i.test(words.trim())) {
      reply(t.writeCanceled);
      return true;
    }
    const s = store.suggestions.get(id);
    const name = (s && store.persons.get(s.person_id)?.name) || "";
    try {
      if (s?.state === "pending") {
        const r = await call(
          "contacts.suggestions.send",
          { id, text: words, author: "owner" },
          { actor: "human" },
          `channel:${rowId}:suggestion`,
        );
        reply(sentText(name, r.delivery));
      } else if (s) {
        await call(
          "channels.send",
          { thread: s.thread_id, text: words },
          { actor: "human" },
          `channel:${rowId}:direct`,
        );
        reply(t.suggestionSent(name));
      }
    } catch (err) {
      reply(t.buttonFailed(errorMessage(err, 200)));
    }
    return true;
  }

  /** How a send to a contact went, for the owner: sent (or on its way), or why it did not reach them. */
  function sentText(name: string, d: { state: string; error?: string | undefined }): string {
    const t = channelTexts(store);
    return d.state === "failed" ? t.suggestionNotSent(name, d.error ?? "") : t.suggestionSent(name);
  }

  /**
   * The owner's text answers an open question: the one APX sent last in this chat, from whatever thread asked it,
   * else one waiting in the thread the text goes to. An older question is not taken: the text may be about else.
   */
  async function answerPending(
    threadId: string,
    words: string,
    rowId: string,
    to: { channel: string; conversation: string },
  ): Promise<boolean> {
    const last = store.channels.outbox.last(to.channel, to.conversation);
    const asked = last?.kind === "input" && last.state === "sent" ? last.body.input_id : undefined;
    const open = (id: string) => store.inputs.pending().find((i) => i.id === id && i.kind === "question");
    const question =
      (asked ? open(asked) : undefined) ?? store.inputs.pending(threadId).find((i) => i.kind === "question");
    if (!question) return false;
    // Answered on the phone, only Home goes on talking there; another chat keeps its conversation in the app.
    if (store.threads.get(question.thread_id)?.kind === "home") {
      store.threads.mergeContext(question.thread_id, { reply_to: to });
      store.runs.setReplyTo(question.run_id, to);
    }
    deps.answeredHere(question.id, to, "text");
    await call("runs.respond", { input: question.id, text: words }, { actor: "human" }, `channel:${rowId}:respond`);
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
    // Pressed once, its message stops offering it; ticking an option or sending none keeps the buttons.
    const keeps = button.kind === "toggle" || button.kind === "confirm";
    if (a.ref && !keeps) void deps.setButtons(channel, a.conversation, a.ref, []);
    try {
      if (button.kind === "review") {
        const person = store.persons.get(button.person);
        if (!person) return;
        const answer = button.decision === "answer";
        await call("contacts.set", { id: person.id, name: person.name, muted: !answer }, { actor: "human" });
        reply(answer ? t.willAnswer(person.name) : t.keptQuiet(person.name));
        return;
      }
      if (button.kind === "suggestion") {
        const s = store.suggestions.get(button.id);
        if (s?.state !== "pending") {
          reply(t.suggestionGone);
          return;
        }
        const name = store.persons.get(s.person_id)?.name ?? "";
        if (button.decision === "send") {
          const r = await call("contacts.suggestions.send", { id: s.id }, { actor: "human" });
          reply(sentText(name, r.delivery));
        } else if (button.decision === "write") {
          const w = deps.suggestions.write(s.id, channel, a.conversation);
          reply(t.writeNow(w.name, w.minutes));
        } else {
          await call("contacts.suggestions.discard", { id: s.id }, { actor: "human" });
          reply(t.suggestionDropped(name));
        }
        return;
      }
      if (button.kind === "continue") {
        // The core checks again that the session's last run is the stopped one, so a second press does nothing.
        const { runs } = await call("threads.get", { thread: button.session }, { actor: "human" });
        const latest = runs.toSorted((x, y) => y.started_at.localeCompare(x.started_at))[0];
        if (!latest) return;
        await call(
          "threads.send",
          { thread: button.session, text: t.goOnPrompt, mode: "queue", continue_run: latest.id },
          { actor: "human" },
          `channel:${a.ref ?? latest.id}:go-on`,
        );
        reply(t.wentOn);
        return;
      }
      if (button.kind === "pairing") {
        await call("pairing.respond", { code: button.code, decision: button.decision }, { actor: "human" });
        reply(button.decision === "contact" ? t.approved : t.denied);
        return;
      }
      if (button.kind === "news") {
        await newsButton(channel, a, button);
        return;
      }
      await inputButton(channel, a, button, reply);
    } catch (err) {
      const msg = errorMessage(err, 200);
      log.warn({ channel, err: msg }, "channel button not handled");
      reply(t.buttonFailed(msg));
    }
  }

  /** A release news action pressed: what it asks goes to the agent in the owner's chat there, as their words. */
  async function newsButton(channel: string, a: InboundAction, button: Extract<Button, { kind: "news" }>) {
    const ask = newsAction(button.entry, button.index);
    const cfg = deps.configs().find((c) => c.id === channel);
    if (!ask || !cfg) return;
    const thread = ownerThread(cfg, a.conversation);
    const name = store.persons.get(OWNER_ID)?.name ?? a.sender.name;
    await call(
      "threads.send",
      { thread: thread.id, text: ask.prompt, mode: cfg.concurrency },
      {
        actor: "human",
        channel: { id: cfg.id, conversation: a.conversation, person_id: OWNER_ID, name, role: "owner" },
      },
    );
  }

  /** A press on a confirmation or question's button: answer it, or tick an option of a multi-choice one. */
  async function inputButton(
    channel: string,
    a: InboundAction,
    button: Extract<Button, { inputId: string }>,
    reply: (text: string) => void,
  ): Promise<void> {
    const t = channelTexts(store);
    const input = store.inputs.get(button.inputId);
    if (input?.state !== "pending") {
      if (a.ref) void deps.setButtons(channel, a.conversation, a.ref, []);
      reply(t.inputGone);
      return;
    }
    const picked = ticked.get(input.id) ?? new Set<number>();
    if (button.kind === "toggle") {
      if (input.options?.[button.index] === undefined) return;
      if (!picked.delete(button.index)) picked.add(button.index);
      if (ticked.size > 200) ticked.clear();
      ticked.set(input.id, picked);
      const shown = inputPresentation({ ...input, input_id: input.id }, t, picked);
      // A channel that cannot change a sent message's buttons gets the question again, ticked.
      if (!(a.ref && (await deps.setButtons(channel, a.conversation, a.ref, shown.buttons))))
        delivery.enqueue({
          channel,
          conversation: a.conversation,
          kind: "input",
          body: { ...shown, input_id: input.id },
        });
      return;
    }
    if (button.kind === "confirm" && !picked.size) {
      reply(t.pickSome);
      return;
    }
    if (button.kind === "confirm" && a.ref) void deps.setButtons(channel, a.conversation, a.ref, []);
    const at = { channel, conversation: a.conversation };
    if (store.threads.get(input.thread_id)?.kind === "home") {
      store.threads.mergeContext(input.thread_id, { reply_to: at });
      store.runs.setReplyTo(input.run_id, at);
    }
    deps.answeredHere(input.id, at, "button");
    if (button.kind === "input") {
      await call("runs.respond", { input: input.id, decision: button.answer }, { actor: "human" });
      reply(button.answer === "approve" ? t.approved : t.denied);
      return;
    }
    const text =
      button.kind === "skip"
        ? t.skipped
        : button.kind === "confirm"
          ? [...picked]
              .sort((x, y) => x - y)
              .flatMap((i) => input.options?.[i] ?? [])
              .join(", ")
          : input.options?.[button.index];
    if (!text) return;
    await call("runs.respond", { input: input.id, text }, { actor: "human" });
    ticked.delete(input.id);
    reply(t.answered(text));
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

/** The tray notice of a pairing request, closed when the owner answers it. */
export const pairingRef = (code: string) => `pairing:${code}`;
