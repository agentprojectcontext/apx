// What arrives on a channel. Who wrote (an exact address match) decides where the words go: the owner's thread, a
// contact's sealed thread, or a pairing code for a stranger. Button presses decide only when the owner presses them.

import type { Thread } from "@apx/protocol";
import type { Inbound, InboundAction, OutboxRow, Presentation } from "../domain/channels.ts";
import type { NewNotification } from "../domain/notifications.ts";
import { OWNER_ID } from "../domain/persons.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { InternalCall } from "../rpc/internal.ts";
import type { Services } from "../services/registry.ts";
import { untrusted } from "../tools/result.ts";
import type { Delivery } from "./delivery.ts";
import { buttonId, parseButton } from "./notices.ts";
import { channelTexts } from "./texts.ts";
import type { ChannelConfig } from "./types.ts";

/** A contact gets at most this many automatic answers per hour; then the owner is told once. */
const CONTACT_PER_HOUR = 20;
const HOUR_MS = 3600_000;

export function createInbound(deps: {
  store: Store;
  log: Log;
  call: InternalCall;
  services: Services;
  delivery: Delivery;
  configs(): ChannelConfig[];
  notifyOwner(body: Presentation, kind?: OutboxRow["kind"], threadId?: string): boolean;
  /** A notice in the app's attention tray. */
  attention(n: NewNotification): void;
}) {
  const { store, log, call, delivery } = deps;
  const recent = new Map<string, number[]>();
  const paused = new Set<string>();

  /** Stores a one-to-one message and handles it; groups are never stored nor answered. */
  function receive(channel: string, m: Inbound): void {
    if (!m.private) return;
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
    const person = store.persons.byAddress(cfg.id, m.sender.id);
    if (!person) {
      stranger(cfg, m);
      return "ignored";
    }
    if (person.role === "blocked") return "ignored";
    const owner = person.role === "owner";
    const thread = owner ? ownerThread(cfg, m.conversation) : contactThread(cfg, m.conversation, person);
    // A silenced contact costs nothing: no transcription, no model call, no rate-limit notice to the owner.
    if (!owner && person.muted) {
      keepQuiet(thread.id, cfg.id, person, m.voice ? `${m.text ? `${m.text}\n` : ""}[voice note]` : m.text);
      return "done";
    }
    if (!owner && overLimit(person.id, person.name)) return "ignored";
    const text = m.voice ? await heard(m, thread.id) : m.text;
    if (owner && (await answerPending(thread.id, text, rowId))) return "done";
    await call(
      "threads.send",
      { thread: thread.id, text, mode: owner ? cfg.concurrency : "queue" },
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
    return "done";
  }

  /** A voice note as words the agent can read (with its caption, if any); says so when it could not be heard. */
  async function heard(m: Inbound, threadId: string): Promise<string> {
    const voice = m.voice;
    if (!voice) return m.text;
    const caption = m.text ? `${m.text}\n` : "";
    if (!deps.services.hasKind("transcription")) return `${caption}[voice note: no transcription engine is set up]`;
    try {
      const { text } = await deps.services.transcribe(
        { bytes: Buffer.from(voice.data, "base64"), mime: voice.mime, thread: threadId },
        AbortSignal.timeout(3 * 60_000),
      );
      return `${caption}[voice note] ${text || "(silence)"}`;
    } catch (err) {
      log.warn({ err: errorMessage(err, 200) }, "voice note not transcribed");
      return `${caption}[voice note: it could not be transcribed]`;
    }
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

  function stranger(cfg: ChannelConfig, m: Inbound): void {
    if (cfg.strangers !== "pair") return;
    const { request, fresh } = store.channels.pairing.request({
      channel: cfg.id,
      external_id: m.sender.id,
      conversation: m.conversation,
      name: m.sender.name.slice(0, 80),
      text: m.text,
    });
    // One code per sender until it expires: a stranger writing again gets no new message.
    if (!fresh) return;
    const t = channelTexts(store);
    const agent = store.agents.get(cfg.agent_id)?.name ?? "APX";
    delivery.enqueue({
      channel: cfg.id,
      conversation: m.conversation,
      kind: "pairing",
      body: { text: t.pairing(request.name, agent, request.code) },
    });
    deps.notifyOwner(
      {
        text: t.pairingOwner(request.name, cfg.label, request.code),
        buttons: [
          { id: buttonId.pairing(request.code, "contact"), label: t.asContact },
          { id: buttonId.pairing(request.code, "deny"), label: t.ignore },
        ],
      },
      "pairing",
    );
    deps.attention({
      kind: "channel",
      title: request.name,
      body: t.pairingApp(request.name, cfg.label, request.code),
      ref: pairingRef(request.code),
    });
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
   * A silenced contact's message: kept in their chat (and in what the agent will read if the owner unsilences them),
   * marked unread, never answered.
   */
  function keepQuiet(threadId: string, channel: string, person: { id: string; name: string }, text: string): void {
    store.tx(() => {
      store.messages.add({
        thread_id: threadId,
        author: { kind: "person", id: person.id, name: person.name, channel },
        parts: [{ type: "text", text }],
      });
      store.modelLog.append(threadId, undefined, [
        { role: "user", content: untrusted("channel_message", { from: person.name, channel, silenced: "yes" }, text) },
      ]);
      const t = store.threads.get(threadId);
      store.threads.patch(threadId, { preview: previewOf(text), unread: (t?.unread ?? 0) + 1 });
    });
  }

  /** The owner's text answers an open question of that thread, when one is waiting for words. */
  async function answerPending(threadId: string, words: string, rowId: string): Promise<boolean> {
    const open = store.inputs.pending(threadId).find((i) => i.kind === "question");
    if (!open) return false;
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
      const input = store.inputs.get(button.inputId);
      if (input?.state !== "pending") return;
      store.threads.mergeContext(input.thread_id, { reply_to: { channel, conversation: a.conversation } });
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
    /** Boot: messages stored but not handled before a restart. */
    resume(): void {
      for (const row of store.channels.inbox.pending()) void process(row);
    },
  };
}

/** The tray notice of a pairing request, closed when the owner answers it. */
export const pairingRef = (code: string) => `pairing:${code}`;
