// Channels: the owner's Telegram bots (later WhatsApp…). This module runs their adapters and sends what goes out:
// the answer of a turn started on a channel, confirmations with buttons, and notices to the owner.
// What comes in is handled by inbound.ts, writing to a contact or a room outside a turn by outgoing.ts; sending
// goes through the durable outbox (delivery.ts).
// See DECISIONS.md#d-014

import type { ChannelInfo, CoreEvent, Part } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { OutboxRow, Presentation } from "../domain/channels.ts";
import { inQuietHours, noticePrefs } from "../domain/notices.ts";
import type { NewNotification } from "../domain/notifications.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { audienceOf } from "../engine/audience.ts";
import { isSkip } from "../engine/routines.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { InternalCall } from "../rpc/internal.ts";
import type { Secrets } from "../secrets.ts";
import { splitSpoken } from "../services/audio.ts";
import type { Services } from "../services/registry.ts";
import { reactAnswer } from "./closers.ts";
import { createDelivery } from "./delivery.ts";
import { guardReply } from "./guard.ts";
import { createInbound } from "./inbound.ts";
import { inputPresentation } from "./notices.ts";
import { createOutgoing } from "./outgoing.ts";
import { createPoster } from "./post.ts";
import { createRooms, quietMentions } from "./rooms.ts";
import { channelTexts } from "./texts.ts";
import { type AdapterFactory, type ChannelAdapter, type ChannelConfig, ChannelRefused } from "./types.ts";

const TYPING_EVERY_MS = 4500;
/** Longer than this, what came before the first tool is part of the answer, not an "on it" line. */
const ACK_MAX = 300;

type Live = {
  config: ChannelConfig;
  adapter: ChannelAdapter;
  ac: AbortController;
  /** The next start after a failure that may pass (the network); cleared when the channel stops. */
  retry?: ReturnType<typeof setTimeout>;
  status: ChannelInfo["status"];
  error?: string | undefined;
  account?: string | undefined;
  /** A QR to link the account, while one is waiting to be scanned. */
  qr?: string | undefined;
};

const tokenName = (id: string) => `channel-${id}`;
const RETRY_MS = [10_000, 30_000, 60_000, 120_000, 300_000];

export function createChannels(deps: {
  store: Store;
  home: string;
  secrets: Secrets;
  bus: Bus;
  log: Log;
  factories: Record<string, AdapterFactory>;
  /** The router, as a client: channel messages enter through the same door as everyone's. */
  call: InternalCall;
  /** Transcription of voice notes, voice notes for answers, and the bytes of what is sent. */
  services: Services;
  /** Notices for the app's attention tray. */
  attention: (n: NewNotification) => void;
  /** Waits before starting again a channel that failed to start; the last one repeats. */
  retryMs?: readonly number[];
  /** A paired device's push, when the owner picked it as where notices go; false when it has none. */
  pushOwner?: (deviceId: string, text: string) => boolean;
  /** A cheap model's one-shot answer: whether an uncalled message in a "useful" room deserves an answer. */
  judge?: (system: string, user: string) => Promise<string | undefined>;
  /** How long a room waits for one person's quick messages to settle (tests shorten it). */
  roomBurstMs?: number;
}) {
  const retryMs = deps.retryMs ?? RETRY_MS;
  const { store, secrets, log } = deps;
  const live = new Map<string, Live>();
  const typing = new Map<string, ReturnType<typeof setInterval>>();
  /** Runs whose "on it" line already went out: the words written before their first tool call. */
  const acked = new Map<string, string>();
  /** Per run: the answer's draft on the channel (its id, when it was last sent, a pending update). */
  const drafting = new Map<string, { id: number; at: number; timer: ReturnType<typeof setTimeout> | undefined }>();
  const announced = new Set<string>();
  const escalations = new Map<string, ReturnType<typeof setTimeout>>();
  /** Settings changes of one channel apply one after another (two quick saves never leave two pollers). */
  const changing = new Map<string, Promise<unknown>>();
  let stopped = false;

  const configs = (): ChannelConfig[] => store.settings.read("channels");

  const delivery = createDelivery({
    store,
    log,
    target: (id) => {
      const l = live.get(id);
      return l ? { adapter: l.adapter, running: l.status === "running" } : undefined;
    },
    configured: (id) => configs().some((c) => c.id === id),
    media: (id) => deps.services.read(id),
  });

  /**
   * Something for the owner, on their preferred channel or another that knows them (the outbox waits while it is not
   * running); in quiet hours it arrives without sound. False when no channel knows the owner.
   */
  function notifyOwner(body: Presentation, kind: OutboxRow["kind"] = "notice", threadId?: string): boolean {
    const prefs = noticePrefs(store);
    // The owner's phone, when they picked it: a push instead of a channel message (a channel if it has no push).
    if (prefs.channel?.startsWith("device:") && deps.pushOwner?.(prefs.channel.slice(7), body.text)) return true;
    const order = [...live.values()].sort(
      (a, b) =>
        Number(b.config.id === prefs.channel) - Number(a.config.id === prefs.channel) ||
        Number(b.status === "running") - Number(a.status === "running"),
    );
    for (const l of order) {
      const addr = store.persons.ownerAddress(l.config.id);
      if (!addr) continue;
      delivery.enqueue({
        channel: l.config.id,
        conversation: addr.external_id,
        thread_id: threadId,
        kind,
        body: {
          ...(body.optionalButtons && !l.adapter.caps.buttons ? { text: body.text } : body),
          ...(inQuietHours(prefs) ? { silent: true } : {}),
        },
      });
      return true;
    }
    return false;
  }

  const rooms = createRooms({
    store,
    log,
    call: deps.call,
    notifyOwner: (body) => notifyOwner(body),
    judge: deps.judge,
    ...(deps.roomBurstMs !== undefined ? { burstMs: deps.roomBurstMs } : {}),
  });
  const outgoing = createOutgoing({
    store,
    configs,
    live: (id) => live.get(id),
    delivery,
    poster: createPoster(store, delivery),
    rooms,
    services: deps.services,
  });
  const inbound = createInbound({
    store,
    home: deps.home,
    log,
    call: deps.call,
    services: deps.services,
    delivery,
    configs,
    notifyOwner,
    attention: deps.attention,
    ownAccount: (id) => Boolean(live.get(id)?.adapter.caps.ownAccount),
    rooms,
    react: reactOn,
  });

  /** Puts the agent's emoji on a platform message; false when the channel has no reactions or is not running. */
  async function reactOn(id: string, conversation: string, ref: string, emoji: string): Promise<boolean> {
    const l = live.get(id);
    if (l?.status !== "running" || !l.adapter.caps.reactions || !l.adapter.react) return false;
    await l.adapter.react(conversation, ref, emoji);
    return true;
  }

  /**
   * The agent answered with a reaction ("REACT ❤️") to the other side's last message here: put on it, shown on that
   * message, and the words taken out of the chat (the model log keeps them). False when it could not be done.
   */
  async function reactInstead(run: RunRecord, to: { channel: string; conversation: string }, emoji: string) {
    const last = theirLast(run.thread_id, to);
    const ok =
      last &&
      (await reactOn(to.channel, to.conversation, last.ref, emoji).catch((err: unknown) => {
        log.warn({ run: run.id, err: errorMessage(err, 200) }, "channel reaction not sent");
        return false;
      }));
    hideWords(run.message_id);
    if (ok) {
      if (last.message_id) store.messages.setReaction(last.message_id, "agent", emoji);
      return;
    }
    // Words instead would be a stray emoji in their chat: nothing goes, and the owner hears why.
    const where = store.threads.get(run.thread_id)?.title ?? to.channel;
    const text = channelTexts(store).reactFailed(emoji, where);
    deps.attention({ kind: "channel", level: "warn", title: where, body: text, thread_id: run.thread_id });
  }

  /**
   * The other side's last message in a chat: as kept when it arrived, else the last one stored for that
   * conversation (messages from before that was kept; shown on the contact's last message here).
   */
  function theirLast(threadId: string, to: { channel: string; conversation: string }) {
    const kept = store.threads.context(threadId).their_last;
    if (kept?.channel === to.channel && kept.conversation === to.conversation) return kept;
    const m = store.channels.inbox.latest(to.channel, to.conversation);
    // A WhatsApp message's own id is its external_id; other channels' older rows did not keep one.
    const ref = m?.ref ?? (live.get(to.channel)?.config.type === "whatsapp" ? m?.external_id : undefined);
    if (!ref) return undefined;
    const theirs = store.messages.list(threadId).findLast((x) => x.author.kind === "person");
    return { ref, message_id: theirs?.id };
  }

  /** An answer that was only a signal (SKIP, REACT): its words leave the chat; the model log keeps them. */
  function hideWords(messageId: string | undefined): void {
    const msg = messageId ? store.messages.get(messageId) : undefined;
    if (msg) store.messages.update({ ...msg, parts: msg.parts.filter((p) => p.type !== "text") });
  }

  /** A confirmation nobody answered in the app after a while also goes to the owner's channel. */
  function followUp(part: Extract<Part, { type: "input" }>, threadId: string): void {
    const after = noticePrefs(store).inputs_after_s;
    if (!after || escalations.has(part.input_id)) return;
    const timer = setTimeout(() => {
      escalations.delete(part.input_id);
      if (stopped || store.inputs.get(part.input_id)?.state !== "pending" || announced.has(part.input_id)) return;
      if (notifyOwner(inputPresentation(part, channelTexts(store)), "input", threadId)) announced.add(part.input_id);
    }, after * 1000);
    timer.unref?.();
    escalations.set(part.input_id, timer);
  }

  // ── replies, confirmations, typing ────────────────────────────────────
  const replyTo = (runId: string) => {
    const run = store.runs.get(runId);
    if (!run) return undefined;
    if (run.input && "reply_to" in run.input) return run.input.reply_to ?? undefined;
    const origin = run.input?.origin;
    if (origin?.kind === "channel") return { channel: origin.channel, conversation: origin.conversation };
    return store.threads.context(run.thread_id).reply_to;
  };

  /**
   * A run ended: its answer returns to its own destination, even if another message changed the thread's channel.
   */
  function afterRun(run: RunRecord): void {
    stopTyping(run.id);
    void reply(run).catch((err) => log.warn({ run: run.id, err: errorMessage(err, 200) }, "channel reply not sent"));
  }

  async function reply(run: RunRecord): Promise<void> {
    const ack = acked.get(run.id);
    acked.delete(run.id);
    const to = replyTo(run.id);
    if (!to || run.trigger === "surface") return;
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    let out = (msg?.parts ?? [])
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
    // The "on it" line already went out on its own (an engine may keep it in front of the answer, or replace it).
    if (ack && out.startsWith(ack)) out = out.slice(ack.length).trim();
    const thread = store.threads.get(run.thread_id);
    const audience = thread ? audienceOf(store, thread) : undefined;
    const why = (run.error ?? "").replace(/^Could not finish: /, "").slice(0, 200);
    const room = audience?.kind === "contact" ? audience.room : undefined;
    if (!out && run.state === "failed" && room) {
      // A public room never sees what went wrong inside APX; the owner does.
      const text = channelTexts(store).roomFailed(`#${room.name}`, why);
      notifyOwner({ text }, "notice", run.thread_id);
      deps.attention({ kind: "channel", level: "error", title: `#${room.name}`, body: text, thread_id: run.thread_id });
      return;
    }
    if (!out && run.state === "failed") {
      if (audience?.kind === "contact") {
        // A contact never sees what went wrong inside APX; the owner does.
        out = channelTexts(store).contactFailed;
        const text = channelTexts(store).contactFailedOwner(audience.name, why);
        notifyOwner({ text }, "notice", run.thread_id);
        deps.attention({ kind: "channel", level: "error", title: audience.name, body: text, thread_id: run.thread_id });
      } else out = channelTexts(store).failed(why);
    }
    const images = (msg?.parts ?? []).flatMap((p) =>
      p.type === "image" && p.media_id ? [{ id: p.media_id, kind: "image" as const, mime: p.mime ?? "image/png" }] : [],
    );
    if (run.state === "completed" && isSkip(out)) {
      hideWords(run.message_id);
      return;
    }
    const emoji = run.state === "completed" ? reactAnswer(out) : undefined;
    if (emoji) {
      await reactInstead(run, to, emoji);
      return;
    }
    if (!out && !images.length) return;
    if (audience?.kind === "contact") out = guardReply(out);
    if (room) out = quietMentions(out);
    const replyRef = room && to.message ? { reply_to: to.message } : {};
    const send = (body: Presentation) =>
      delivery.enqueue({
        channel: to.channel,
        conversation: to.conversation,
        thread_id: run.thread_id,
        ...(msg ? { message_id: msg.id } : {}),
        kind: "reply",
        body,
      });
    const voice = out && run.state === "completed" ? await voiceFor(run.thread_id, out) : undefined;
    if (!voice) {
      send({ text: out, media: images, ...replyRef });
      return;
    }
    // A voice note with its transcript (only what it says), then the rest of the answer as its own message.
    send({ text: voice.spoken, media: [voice.media], mediaFirst: true, ...replyRef });
    if (voice.rest || images.length) send({ text: voice.rest, media: images });
  }

  /** When the chat asked for spoken answers: the first part as a voice note (shown in the app too), and the rest. */
  async function voiceFor(threadId: string, text: string) {
    if (!store.threads.context(threadId).voice_replies || !deps.services.hasKind("speech")) return undefined;
    const { spoken, rest } = splitSpoken(text);
    if (!spoken) return undefined;
    try {
      const m = await deps.services.voiceNote(spoken, threadId, AbortSignal.timeout(90_000));
      return { media: { id: m.id, kind: "audio" as const, mime: m.mime }, spoken, rest };
    } catch (err) {
      log.warn({ thread: threadId, err: errorMessage(err, 200) }, "no voice note; the answer goes as text");
      return undefined;
    }
  }

  function stopTyping(runId: string): void {
    clearInterval(typing.get(runId));
    typing.delete(runId);
    const d = drafting.get(runId);
    if (d) clearTimeout(d.timer);
    drafting.delete(runId);
  }

  /**
   * The owner sees the answer as it is written, where the channel shows drafts: at most one update per DRAFT_EVERY_MS
   * (the first at once, the last when writing pauses). A contact's answer is filtered before it goes out, so it is
   * never drafted.
   */
  function onText(threadId: string, messageId: string): void {
    const msg = store.messages.get(messageId);
    const runId = msg?.run_id;
    if (!runId || msg.author.kind !== "agent") return;
    const to = replyTo(runId);
    const l = to ? live.get(to.channel) : undefined;
    if (!to || !l?.adapter.caps.drafts || !l.adapter.draft) return;
    const thread = store.threads.get(threadId);
    if (!thread || audienceOf(store, thread).kind !== "owner") return;
    const d = drafting.get(runId) ?? { at: 0, timer: undefined, id: draftId(messageId) };
    drafting.set(runId, d);
    const push = () => {
      d.timer = undefined;
      d.at = Date.now();
      const text = (store.messages.get(messageId)?.parts ?? [])
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("\n")
        .trim();
      void l.adapter.draft?.(to.conversation, d.id, text).catch(() => {});
    };
    const wait = d.at + DRAFT_EVERY_MS - Date.now();
    if (wait <= 0) push();
    else d.timer ??= setTimeout(push, wait);
    d.timer?.unref?.();
  }

  /**
   * The agent reached its first tool: what it wrote before it ("on it", in its words) goes to the owner at once, so a
   * long turn does not leave them waiting in silence. Only for the owner, and once per run.
   */
  function onTool(threadId: string, messageId: string): void {
    const msg = store.messages.get(messageId);
    const runId = msg?.run_id;
    if (!runId || acked.has(runId) || msg.author.kind !== "agent") return;
    const to = replyTo(runId);
    if (!to) return;
    const thread = store.threads.get(threadId);
    if (!thread || audienceOf(store, thread).kind !== "owner") return;
    const first = msg.parts.findIndex((p) => p.type === "tool");
    const said = msg.parts
      .slice(0, Math.max(0, first))
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
    if (!said || said.length > ACK_MAX) return;
    acked.set(runId, said);
    delivery.enqueue({
      channel: to.channel,
      conversation: to.conversation,
      thread_id: threadId,
      message_id: messageId,
      kind: "reply",
      body: { text: said },
    });
  }

  function startTyping(runId: string): void {
    const to = replyTo(runId);
    const l = to ? live.get(to.channel) : undefined;
    if (!to || !l?.adapter.caps.typing || !l.adapter.typing || typing.has(runId)) return;
    const ping = () => void l.adapter.typing?.(to.conversation).catch(() => {});
    ping();
    const iv = setInterval(ping, TYPING_EVERY_MS);
    iv.unref?.();
    typing.set(runId, iv);
  }

  function onInput(part: Extract<Part, { type: "input" }>, threadId: string): void {
    if (announced.has(part.input_id)) return;
    const thread = store.threads.get(threadId);
    if (!thread || audienceOf(store, thread).kind !== "owner") return;
    const runId = store.inputs.get(part.input_id)?.run_id;
    const to = runId ? replyTo(runId) : undefined;
    // Asked from the app: it waits there first, then follows the owner.
    if (!to) {
      followUp(part, threadId);
      return;
    }
    announced.add(part.input_id);
    delivery.enqueue({
      channel: to.channel,
      conversation: to.conversation,
      thread_id: threadId,
      kind: "input",
      body: inputPresentation(part, channelTexts(store)),
    });
  }

  function onEvent(e: CoreEvent): void {
    if (e.type === "run.updated") {
      if (e.run.state === "working" && e.run.trigger !== "surface") startTyping(e.run.id);
      else if (e.run.state !== "working") stopTyping(e.run.id);
    } else if (e.type === "message.part" && e.part.type === "tool") {
      onTool(e.thread_id, e.message_id);
    } else if (e.type === "message.part" && e.part.type === "text") {
      onText(e.thread_id, e.message_id);
    } else if (e.type === "message.part" && e.part.type === "input" && e.part.state === "pending") {
      onInput(e.part, e.thread_id);
    } else if (e.type === "message.created" && e.message.author.kind === "system") {
      // Agents stopped by the breaker: the owner hears it wherever they are.
      const paused = e.message.parts.find((p) => p.type === "notice" && p.code === "breaker.paused");
      if (paused?.type === "notice") notifyOwner({ text: paused.text }, "notice", e.message.thread_id);
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────
  async function startOne(config: ChannelConfig, attempt = 0): Promise<void> {
    const factory = deps.factories[config.type];
    if (!factory || !config.enabled || stopped) return;
    const ac = new AbortController();
    const adapter = factory(config, secrets.resolve(`secret://${tokenName(config.id)}`));
    const l: Live = { config, adapter, ac, status: "starting" };
    live.set(config.id, l);
    try {
      const r = await adapter.start({
        receive: (m) => inbound.receive(config.id, m),
        action: (a) => void inbound.action(config.id, a),
        reaction: (r) => inbound.reaction(config.id, r),
        status: (s, error) => {
          l.status = s;
          l.error = error;
          if (s === "running") delivery.kick();
        },
        qr: (code) => {
          l.qr = code;
        },
        receipt: (externalId, state) => delivery.receipt(config.id, externalId, state),
        identified: ({ account, owner }) => {
          l.account = account;
          if (!owner) return;
          // The owner's own phone: whoever writes from it is the owner. A line of its own is nobody: the owner is
          // the phone they write to it from.
          const holder = store.persons.byAddress(config.id, owner);
          if (config.self_owner && holder?.role !== "owner") {
            store.persons.owner();
            store.persons.link(OWNER_ID, { channel: config.id, external_id: owner, label: config.label });
          } else if (!config.self_owner && holder?.role === "owner") {
            const a = holder.addresses.find((x) => x.channel === config.id && x.external_id === owner);
            if (a) store.persons.unlink(a.id);
          }
        },
        signal: ac.signal,
      });
      if (r.account) l.account = r.account;
      if (l.status === "starting" && !r.waiting) l.status = "running";
      delivery.kick();
    } catch (err) {
      l.status = "error";
      l.error = errorMessage(err, 300);
      log.warn({ channel: config.id, err: l.error }, "channel did not start");
      if (err instanceof ChannelRefused || ac.signal.aborted || stopped) return;
      // Most likely the network: try again, waiting longer each time.
      const wait = retryMs[Math.min(attempt, retryMs.length - 1)] ?? 300_000;
      l.retry = setTimeout(() => {
        if (live.get(config.id) !== l || stopped) return;
        void serially(config.id, async () => {
          if (live.get(config.id) !== l) return;
          await stopOne(config.id);
          await startOne(config, attempt + 1);
        });
      }, wait);
      l.retry.unref?.();
    }
  }

  async function stopOne(id: string): Promise<void> {
    const l = live.get(id);
    if (!l) return;
    clearTimeout(l.retry);
    l.ac.abort();
    await l.adapter.stop().catch(() => {});
    if (live.get(id) === l) live.delete(id);
  }

  /** Applies one channel's new settings after any change already in progress for it. */
  function serially(id: string, work: () => Promise<void>): Promise<void> {
    const next = (changing.get(id) ?? Promise.resolve()).then(work, work);
    changing.set(id, next);
    void next.finally(() => {
      if (changing.get(id) === next) changing.delete(id);
    });
    return next;
  }

  /** "123456789:••••wxyz": enough to tell which bot's token is stored, never enough to use it. */
  const hintOf = (token: string) => {
    const colon = token.indexOf(":");
    return `${colon > 0 ? token.slice(0, colon + 1) : ""}••••${token.slice(-4)}`;
  };

  function info(): ChannelInfo[] {
    return configs().map((c) => {
      const l = live.get(c.id);
      const token = secrets.resolve(`secret://${tokenName(c.id)}`);
      return {
        ...c,
        token_set: token !== undefined,
        // A mailbox's password shows none of its characters.
        ...(token ? { token_hint: c.type === "email" ? "••••••••" : hintOf(token) } : {}),
        status: l?.status ?? "off",
        ...(l?.error ? { error: l.error } : {}),
        ...(l?.account ? { account: l.account } : {}),
        ...(l?.qr ? { qr: l.qr } : {}),
      };
    });
  }

  return {
    info,
    ...outgoing,
    notifyOwner,
    approved: inbound.approved,
    afterRun,
    /** Adds, changes or removes a channel and (re)starts it. */
    async set(id: string, config: Omit<ChannelConfig, "id"> | null, token?: string): Promise<ChannelInfo[]> {
      await serially(id, async () => {
        if (token) secrets.set(tokenName(id), token);
        const before = configs().find((c) => c.id === id);
        const rest = configs().filter((c) => c.id !== id);
        store.settings.write("channels", config ? [...rest, { ...config, id }] : rest);
        // Who answers, where the owner's words go, overlapping messages and strangers are read per message: the
        // connection stays up (a WhatsApp restart is seconds of "connecting"). It restarts only for what it runs
        // with, or to try again when it is down.
        const l = live.get(id);
        if (config && before && l && !token && l.status !== "error" && !restartsFor(before, config)) {
          l.config = { ...config, id };
          return;
        }
        if (!config) {
          secrets.set(tokenName(id), null);
          await live
            .get(id)
            ?.adapter.forget?.()
            .catch(() => {});
        }
        await stopOne(id);
        const next = configs().find((c) => c.id === id);
        if (next) await startOne(next);
      });
      return info();
    },
    /** Boot: sends cut by a restart become "uncertain", messages not handled yet are handled, channels start. */
    async start(): Promise<void> {
      const cut = store.channels.outbox.reconcile();
      if (cut) log.warn({ items: cut }, "channel sends cut by the last restart are marked uncertain");
      deps.bus.on(onEvent);
      inbound.resume();
      await Promise.allSettled(configs().map(startOne));
      delivery.kick();
    },
    async stop(): Promise<void> {
      rooms.stop();
      stopped = true;
      delivery.stop();
      for (const iv of typing.values()) clearInterval(iv);
      for (const d of drafting.values()) clearTimeout(d.timer);
      drafting.clear();
      for (const t of escalations.values()) clearTimeout(t);
      typing.clear();
      await Promise.allSettled([...live.keys()].map(stopOne));
    },
  };
}

export type Channels = ReturnType<typeof createChannels>;

const DRAFT_EVERY_MS = 900;

/** A positive 31-bit number per answer (Telegram's draft_id): the same message always gets the same one. */
function draftId(messageId: string): number {
  let h = 0;
  for (const c of messageId) h = (Math.imul(h, 31) + (c.codePointAt(0) ?? 0)) | 0;
  return h & 0x7fffffff || 1;
}

/** Whether a settings change needs the channel started again (what its adapter is built with). */
function restartsFor(a: Omit<ChannelConfig, "id">, b: Omit<ChannelConfig, "id">): boolean {
  // The rooms a bot listens to are part of its connection (Discord subscribes to server messages only with some).
  const rooms = (c: Omit<ChannelConfig, "id">) =>
    (c.rooms?.rooms ?? [])
      .map((r) => r.id)
      .sort()
      .join(",");
  return (
    a.type !== b.type ||
    a.enabled !== b.enabled ||
    Boolean(a.self_owner) !== Boolean(b.self_owner) ||
    rooms(a) !== rooms(b) ||
    JSON.stringify(a.email ?? null) !== JSON.stringify(b.email ?? null)
  );
}
