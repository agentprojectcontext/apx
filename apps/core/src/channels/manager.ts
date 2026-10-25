// Channels: the owner's Telegram bots (later WhatsApp…). This module runs their adapters and sends what goes out:
// the answer of a turn started on a channel, confirmations with buttons, and notices to the owner.
// What comes in is handled by inbound.ts, writing to a contact or a room outside a turn by outgoing.ts; sending
// goes through the durable outbox (delivery.ts).
// See DECISIONS.md#d-014

import { type ChannelInfo, type CoreEvent, noticeText, type Part } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { AuxAbout } from "../domain/aux-calls.ts";
import { type OutboxRow, ownerActsOn, type Presentation } from "../domain/channels.ts";
import { inQuietHours, noticePrefs } from "../domain/notices.ts";
import type { NewNotification } from "../domain/notifications.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { audienceOf } from "../engine/audience.ts";
import { inputPartOf } from "../engine/inputs.ts";
import type { Draft } from "../engine/suggest.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { InternalCall } from "../rpc/internal.ts";
import type { Secrets } from "../secrets.ts";
import { splitSpoken } from "../services/audio.ts";
import type { Services } from "../services/registry.ts";
import { createDelivery } from "./delivery.ts";
import { guardReply } from "./guard.ts";
import { createHeld } from "./held.ts";
import { createInbound } from "./inbound.ts";
import { createInputCards } from "./input-cards.ts";
import { buttonId, inputPresentation } from "./notices.ts";
import { createOutgoing } from "./outgoing.ts";
import { createPoster } from "./post.ts";
import { createRecovery } from "./recover.ts";
import { createRooms, quietMentions, roomMentions } from "./rooms.ts";
import { createSignals } from "./signals.ts";
import { createStickers, type See } from "./stickers.ts";
import { createSuggestions } from "./suggestions.ts";
import { channelTexts } from "./texts.ts";
import {
  type AdapterFactory,
  type ChannelAdapter,
  type ChannelConfig,
  ChannelRefused,
  type HookRequest,
  type HookResponse,
  type ServerRoom,
} from "./types.ts";

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
const MASKED: ReadonlySet<string> = new Set(["email", "googlechat", "teams"]);
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
  judge?: (system: string, user: string, about: AuxAbout) => Promise<string | undefined>;
  /** A model that reads images naming what a picture shows (a sticker's meaning); none: stickers stay unnamed. */
  see?: See;
  /** How long a room waits for one person's quick messages to settle (tests shorten it). */
  roomBurstMs?: number;
  /** The reply a supervised contact would get, drafted with the agent's model and not sent. */
  draft?: (threadId: string, agentId: string, signal?: AbortSignal) => Promise<Draft>;
  /** How long a supervised contact's quick messages may keep coming before one draft answers them (tests shorten it). */
  suggestBurstMs?: number;
  /** The owner's words kept without a turn, for memory (memory-maintenance.ts ownerReplied). */
  ownerReplied?: (messageId: string) => void;
  /** The time attention hours are read against (tests move it). */
  now?: () => Date;
  /** The public address webhooks reach (`<base>`, without `/hooks/…`), while the owner has one on. */
  hookBase?: () => string | undefined;
}) {
  const retryMs = deps.retryMs ?? RETRY_MS;
  const clock = deps.now ?? (() => new Date());
  const { store, secrets, log } = deps;
  const live = new Map<string, Live>();
  const typing = new Map<string, ReturnType<typeof setInterval>>();
  /** Runs whose "on it" line already went out: the words written before their first tool call. */
  const acked = new Map<string, string>();
  const announced = new Set<string>();
  const escalations = new Map<string, ReturnType<typeof setTimeout>>();
  let unsubscribe: () => void = () => {};
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
    failed: (o) => ownerFallback(o),
  });

  /**
   * Something for the owner, on their preferred channel or another that knows them (the outbox waits while it is not
   * running); in quiet hours it arrives without sound. False when no channel knows the owner.
   */
  function notifyOwner(body: Presentation, kind: OutboxRow["kind"] = "notice", threadId?: string): boolean {
    const prefs = noticePrefs(store);
    const refused = new Set(body.refused_by);
    // The owner's phone, when they picked it: a push instead of a channel message (a channel if it has no push).
    if (!refused.size && prefs.channel?.startsWith("device:") && deps.pushOwner?.(prefs.channel.slice(7), body.text))
      return true;
    const order = [...live.values()]
      .filter((l) => !refused.has(l.config.id))
      .sort(
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
          ...shownOn(l.config.id, body),
          ...(inQuietHours(prefs) ? { silent: true } : {}),
        },
      });
      return true;
    }
    return false;
  }

  /**
   * Something for the owner as a channel shows it: buttons only where the owner may answer there, so where the platform cannot vouch for them and
   * for a card only the app answers they give way to where it is answered (DECISIONS.md#d-144).
   */
  function shownOn(channel: string, body: Presentation): Presentation {
    const appOnly = body.input_id ? store.inputs.get(body.input_id)?.app_only : undefined;
    const type = configs().find((c) => c.id === channel)?.type;
    if (!body.buttons?.length || (ownerActsOn(type) && !appOnly)) return body;
    const { buttons: _b, ...rest } = body;
    return { ...rest, text: `${body.text}\n\n${channelTexts(store).inApp}` };
  }

  /**
   * A notice, confirmation or pairing request for the owner that their channel refused goes to the next channel that
   * knows them; with none left, the app's tray says it never arrived.
   */
  function ownerFallback(o: OutboxRow): void {
    if (o.kind === "reply" || store.persons.byAddress(o.channel, o.conversation)?.id !== OWNER_ID) return;
    const { skip: _skip, refused_by = [], ...body } = o.body;
    if (notifyOwner({ ...body, refused_by: [...refused_by, o.channel] }, o.kind, o.thread_id)) return;
    const texts = channelTexts(store);
    deps.attention({
      kind: "channel",
      level: "error",
      title: texts.noticeLostTitle,
      body: texts.noticeLost([...refused_by, o.channel].join(", "), o.error ?? "", o.text.slice(0, 200)),
      thread_id: o.thread_id,
    });
  }

  const rooms = createRooms({
    store,
    log,
    call: deps.call,
    notifyOwner: (body) => notifyOwner(body),
    judge: deps.judge,
    ...(deps.roomBurstMs !== undefined ? { burstMs: deps.roomBurstMs } : {}),
    now: () => clock().getTime(),
  });
  const poster = createPoster(store, delivery);
  const outgoing = createOutgoing({
    store,
    configs,
    live: (id) => live.get(id),
    delivery,
    poster,
    rooms,
    services: deps.services,
  });
  const suggestions = createSuggestions({
    store,
    log,
    notifyOwner,
    attention: deps.attention,
    draft: deps.draft,
    post: poster.post,
    sendAsOwner: outgoing.sendAsOwner,
    burstMs: deps.suggestBurstMs,
  });
  const held = createHeld({ store, configs, suggestions, now: clock });
  const cards = createInputCards({
    store,
    log,
    running: (id) => {
      const l = live.get(id);
      return l?.status === "running" ? l.adapter : undefined;
    },
  });
  const stickers = createStickers({ store, home: deps.home, log, see: deps.see, attention: deps.attention });
  const signals = createSignals({
    store,
    log,
    live: (id) => live.get(id),
    attention: deps.attention,
    delivery,
    stickers,
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
    suggestions,
    stickers,
    react: signals.reactOn,
    answeredHere: cards.answeredHere,
    held,
    now: clock,
    ...(deps.ownerReplied ? { ownerReplied: deps.ownerReplied } : {}),
    setButtons: async (id, conversation, ref, buttons) => {
      const l = live.get(id);
      if (l?.status !== "running" || !l.adapter.setButtons) return false;
      return l.adapter.setButtons(conversation, ref, buttons).then(
        () => true,
        () => false,
      );
    },
  });
  const recovery = createRecovery({
    store,
    home: deps.home,
    log,
    target: (id) => {
      const l = live.get(id);
      return l ? { adapter: l.adapter, label: l.config.label, running: l.status === "running" } : undefined;
    },
  });

  /** A confirmation nobody answered in the app after a while also goes to the owner's channel. */
  function followUp(part: Extract<Part, { type: "input" }>, threadId: string, waited = 0): void {
    const after = noticePrefs(store).inputs_after_s;
    if (!after || escalations.has(part.input_id)) return;
    const timer = setTimeout(
      () => {
        escalations.delete(part.input_id);
        if (stopped || store.inputs.get(part.input_id)?.state !== "pending" || announced.has(part.input_id)) return;
        const body = { ...inputPresentation(part, channelTexts(store)), input_id: part.input_id };
        if (notifyOwner(body, "input", threadId)) announced.add(part.input_id);
      },
      Math.max(0, after * 1000 - waited),
    );
    timer.unref?.();
    escalations.set(part.input_id, timer);
  }

  /**
   * After a restart: a question asked in the app that still waits follows the owner when its time comes (at once if it
   * already came), unless it already went out on a channel.
   */
  function resumeFollowUps(): void {
    for (const input of store.inputs.pending()) {
      if (announced.has(input.id)) continue;
      if (store.channels.outbox.hasInput(input.id)) {
        announced.add(input.id);
        continue;
      }
      const thread = store.threads.get(input.thread_id);
      if (!thread || audienceOf(store, thread).kind !== "owner") continue;
      if (input.run_id && replyTo(input.run_id, true)) continue;
      followUp(inputPartOf(input), input.thread_id, Date.now() - Date.parse(input.created_at));
    }
  }

  // ── replies, confirmations, typing ────────────────────────────────────
  /** Where a run's channel traffic goes: an answer only from a chat that speaks there; a question or an OK always. */
  const replyTo = (runId: string, action = false) => {
    const run = store.runs.get(runId);
    if (!run || (!action && !speaksOnChannel(run.thread_id))) return undefined;
    if (run.input && "reply_to" in run.input) return run.input.reply_to ?? undefined;
    const origin = run.input?.origin;
    if (origin?.kind === "channel") return { channel: origin.channel, conversation: origin.conversation };
    return store.threads.context(run.thread_id).reply_to;
  };

  /**
   * Whose answers go out on a channel: a contact's chat, and among the owner's chats only Home, the super-agent's. Other
   * chats reach the owner's phone only with what needs them (a question, an OK), never their whole conversation.
   */
  function speaksOnChannel(threadId: string): boolean {
    const thread = store.threads.get(threadId);
    return Boolean(thread && (audienceOf(store, thread).kind !== "owner" || thread.kind === "home"));
  }

  /**
   * A run ended: its answer returns to its own destination, even if another message changed the thread's channel.
   */
  function afterRun(run: RunRecord): void {
    stopTyping(run.id);
    passedOn(run);
    void reply(run).catch((err) => log.warn({ run: run.id, err: errorMessage(err, 200) }, "channel reply not sent"));
  }

  /** What a contact left for the owner in this turn (a request, an appointment, a message) reaches them now. */
  function passedOn(run: RunRecord): void {
    const thread = store.threads.get(run.thread_id);
    const audience = thread ? audienceOf(store, thread) : undefined;
    if (audience?.kind !== "contact" || audience.room) return;
    const texts = channelTexts(store);
    for (const s of store.runs.steps(run.id)) {
      if (s.tool !== "pass_request" || s.state !== "ok" || !/^(passed on|updated)/.test(s.result ?? "")) continue;
      const rest = [s.args.when, s.args.details].filter((v) => typeof v === "string" && v).join("\n");
      const text = texts.passedOn(audience.name, String(s.args.kind), String(s.args.summary ?? ""), rest);
      notifyOwner({ text: text.slice(0, 1500) }, "notice", run.thread_id);
    }
  }

  async function reply(run: RunRecord): Promise<void> {
    const ack = acked.get(run.id);
    acked.delete(run.id);
    const to = replyTo(run.id);
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    let out = (msg?.parts ?? [])
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
    // The "on it" line already went out on its own (an engine may keep it in front of the answer, or replace it).
    if (ack && out.startsWith(ack)) out = out.slice(ack.length).trim();
    if (run.trigger !== "surface" && (await signals.handle(run, out, to))) return;
    // A stopped turn's half-written answer is not news: the owner stopped it.
    if (!to || run.trigger === "surface" || run.state === "canceled") return;
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
    // What the agent attached (send_file, make_image) goes with the answer; a file left behind is a promise broken.
    const attached = (msg?.parts ?? []).flatMap((p): NonNullable<Presentation["media"]> => {
      if (p.type === "image" && p.media_id) return [{ id: p.media_id, kind: "image", mime: p.mime ?? "image/png" }];
      if (p.type === "file") return [{ id: p.media_id, kind: "file", mime: p.mime, name: p.name }];
      return [];
    });
    if (!out && !attached.length) return;
    if (audience?.kind === "contact") out = guardReply(out);
    let mentions: Pick<Presentation, "mentions"> = {};
    if (room) {
      out = quietMentions(out);
      // Only a turn the owner started pings the room's people: a member cannot make the bot ping others.
      const o = run.input?.origin;
      if (o?.kind === "user" || (o?.kind === "channel" && o.role === "owner")) {
        const named = roomMentions(out, store.channels.inbox.people(to.channel, to.conversation));
        out = named.text;
        if (named.mentions.length) mentions = { mentions: named.mentions };
      }
    }
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
      send({ text: out, media: attached, ...replyRef, ...mentions });
      return;
    }
    // A voice note with its transcript (only what it says), then the rest of the answer as its own message.
    send({ text: voice.spoken, media: [voice.media], mediaFirst: true, ...replyRef, ...mentions });
    if (voice.rest || attached.length) send({ text: voice.rest, media: attached });
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
    const to = runId ? replyTo(runId, true) : undefined;
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
      body: shownOn(to.channel, { ...inputPresentation(part, channelTexts(store)), input_id: part.input_id }),
    });
  }

  function onEvent(e: CoreEvent): void {
    if (e.type === "run.updated") {
      if (e.run.state === "working" && e.run.trigger !== "surface") startTyping(e.run.id);
      else if (e.run.state !== "working") stopTyping(e.run.id);
    } else if (e.type === "message.part" && e.part.type === "tool") {
      onTool(e.thread_id, e.message_id);
    } else if (e.type === "message.part" && e.part.type === "input") {
      if (e.part.state === "pending") onInput(e.part, e.thread_id);
      else cards.settled(e.part.input_id, e.part.state);
    } else if (e.type === "message.updated") {
      // An answer with no turn listening rewrites the whole message.
      for (const p of e.message.parts) if (p.type === "input") cards.settled(p.input_id, p.state);
    } else if (e.type === "message.created" && e.message.author.kind === "system") {
      // Agents stopped by the breaker: the owner hears it wherever they are.
      const paused = e.message.parts.find((p) => p.type === "notice" && p.code === "breaker.paused");
      if (paused?.type === "notice") notifyOwner({ text: paused.text }, "notice", e.message.thread_id);
      // A delegate APX keeps going on with is no news for the owner's phone: only a stop or a report is (DECISIONS.md#d-116).
      const limit = e.message.parts.find(
        (p) => p.type === "notice" && p.code === "delegation.limit" && !String(p.vars?.variant).startsWith("continued"),
      );
      if (limit?.type === "notice") limitReached(e.message.thread_id, limit);
    }
  }

  /**
   * A delegated run hit a limit: the owner hears it on the channel their chat lives on (else wherever notices go),
   * never in a contact's chat.
   */
  function limitReached(threadId: string, notice: Extract<Part, { type: "notice" }>): void {
    const text = noticeText(notice, store.settings.get("owner_language") === "en" ? "en" : "es");
    // Stopped because it looked stuck: Continue right under the words, so the owner need not write it.
    const session = notice.vars?.subthread;
    const buttons =
      String(notice.vars?.variant).startsWith("stopped") && typeof session === "string"
        ? [{ id: buttonId.goOn(session), label: channelTexts(store).goOn }]
        : undefined;
    const thread = store.threads.get(threadId);
    const to = thread && thread.kind === "home" ? store.threads.context(threadId).reply_to : undefined;
    if (to && live.has(to.channel)) {
      delivery.enqueue({
        channel: to.channel,
        conversation: to.conversation,
        thread_id: threadId,
        kind: "notice",
        body: { text, ...(buttons ? { buttons } : {}), ...(inQuietHours(noticePrefs(store)) ? { silent: true } : {}) },
      });
      return;
    }
    notifyOwner({ text, ...(buttons ? { buttons } : {}) }, "notice", threadId);
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
        room: (g) => sawGroup(config.id, g),
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
        hookUrl: () => {
          const base = deps.hookBase?.();
          return base ? `${base}/hooks/${config.id}` : undefined;
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
        // A mailbox's password, a Google key (JSON, cut anywhere) and a Teams secret show none of their characters.
        ...(token ? { token_hint: MASKED.has(c.type) ? "••••••••" : hintOf(token) } : {}),
        status: l?.status ?? "off",
        ...(l?.error ? { error: l.error } : {}),
        ...(l?.account ? { account: l.account } : {}),
        ...(l?.qr ? { qr: l.qr } : {}),
      };
    });
  }

  /** The groups a channel's bot reported being in (Telegram cannot list them), newest first. */
  const groupsKey = (id: string) => `channel_groups:${id}`;
  function seenGroups(id: string): Array<{ id: string; name: string }> {
    try {
      const v = JSON.parse(store.settings.get(groupsKey(id)) ?? "[]") as unknown;
      return Array.isArray(v) ? (v as Array<{ id: string; name: string }>) : [];
    } catch {
      return [];
    }
  }
  function sawGroup(id: string, g: { id: string; name: string; left?: boolean }): void {
    const known = seenGroups(id);
    const name =
      g.name
        .replace(/[\p{Cc}\p{Cf}]/gu, "")
        .trim()
        .slice(0, 80) || g.id;
    if (!g.left && known[0]?.id === g.id && known[0].name === name) return;
    const rest = known.filter((x) => x.id !== g.id);
    store.settings.set(groupsKey(id), JSON.stringify(g.left ? rest : [{ id: g.id, name }, ...rest].slice(0, 100)));
  }

  /** The rooms of a running channel's servers (or the groups its bot reported), to pick from. */
  async function serverRooms(id: string): Promise<ServerRoom[]> {
    const l = live.get(id);
    if (!l?.adapter.rooms) return seenGroups(id).map((g) => ({ ...g, server: "", writable: true }));
    if (l.status !== "running") throw new Error(`${l.config.label} is not running`);
    return l.adapter.rooms();
  }

  /** A request to a channel's public address: its running adapter answers it; anything else is not found. */
  async function webhook(id: string, req: HookRequest): Promise<HookResponse> {
    const l = live.get(id);
    if (!l?.adapter.webhook) return { status: 404 };
    return l.adapter.webhook(req);
  }

  return {
    info,
    serverRooms,
    webhook,
    ...outgoing,
    notifyOwner,
    approved: inbound.approved,
    afterRun,
    recover: recovery.recover,
    /** Each tick of the office clock: contacts' chats whose channel's hours began are answered (held.ts). */
    openHeld: held.open,
    /** A supervised contact's drafts: the owner sends one (as is or edited) or drops it. */
    suggestions: { send: suggestions.send, discard: suggestions.discard },
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
          store.settings.set(groupsKey(id), "[]");
          // Disabled channels have no live adapter, but their persisted session still needs removing.
          const adapter = l?.adapter ?? (before ? deps.factories[before.type]?.(before, undefined) : undefined);
          await adapter?.forget?.().catch(() => {});
        }
        await stopOne(id);
        const next = configs().find((c) => c.id === id);
        if (next) await startOne(next);
      });
      return info();
    },
    /** Boot: sends cut by a restart become "uncertain", messages not handled yet are handled, channels start. */
    async start(): Promise<void> {
      stopped = false;
      const cut = store.channels.outbox.reconcile();
      if (cut) log.warn({ items: cut }, "channel sends cut by the last restart are marked uncertain");
      unsubscribe();
      unsubscribe = deps.bus.on(onEvent);
      inbound.resume();
      await Promise.allSettled(configs().map(startOne));
      resumeFollowUps();
      delivery.kick();
      void stickers.nameUnnamed().catch((err) => log.warn({ err: errorMessage(err, 200) }, "stickers not named"));
    },
    async stop(): Promise<void> {
      rooms.stop();
      suggestions.stop();
      stopped = true;
      delivery.stop();
      for (const iv of typing.values()) clearInterval(iv);
      for (const t of escalations.values()) clearTimeout(t);
      escalations.clear();
      unsubscribe();
      unsubscribe = () => {};
      typing.clear();
      await Promise.allSettled([...live.keys()].map(stopOne));
    },
  };
}

export type Channels = ReturnType<typeof createChannels>;

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
