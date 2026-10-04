// Channels: the owner's Telegram bots (later WhatsApp…). This module runs their adapters and sends what goes out:
// the answer of a turn whose last words came from a channel, confirmations with buttons, and notices to the owner.
// What comes in is handled by inbound.ts; sending goes through the durable outbox (delivery.ts).
// See DECISIONS.md#d-014

import type { ChannelInfo, CoreEvent, Part } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { OutboxRow, Presentation } from "../domain/channels.ts";
import { inQuietHours, noticePrefs } from "../domain/notices.ts";
import type { NewNotification } from "../domain/notifications.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { audienceOf } from "../engine/audience.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { InternalCall } from "../rpc/internal.ts";
import type { Secrets } from "../secrets.ts";
import { spokenPart } from "../services/audio.ts";
import type { Services } from "../services/registry.ts";
import { createDelivery } from "./delivery.ts";
import { guardReply } from "./guard.ts";
import { createInbound } from "./inbound.ts";
import { inputPresentation } from "./notices.ts";
import { createRooms, quietMentions } from "./rooms.ts";
import { channelTexts } from "./texts.ts";
import { type AdapterFactory, type ChannelAdapter, type ChannelConfig, ChannelRefused } from "./types.ts";

const TYPING_EVERY_MS = 4500;

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
  const inbound = createInbound({
    store,
    log,
    call: deps.call,
    services: deps.services,
    delivery,
    configs,
    notifyOwner,
    attention: deps.attention,
    ownAccount: (id) => Boolean(live.get(id)?.adapter.caps.ownAccount),
    rooms,
  });

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
  const replyTo = (threadId: string) => store.threads.context(threadId).reply_to;

  /**
   * A run ended: while the thread's last words from the owner (or contact) came from a channel, the answer goes back
   * there. Writing in the app clears that, so app turns answer in the app.
   */
  function afterRun(run: RunRecord): void {
    stopTyping(run.id);
    void reply(run).catch((err) => log.warn({ run: run.id, err: errorMessage(err, 200) }, "channel reply not sent"));
  }

  async function reply(run: RunRecord): Promise<void> {
    const to = replyTo(run.thread_id);
    if (!to || run.trigger === "surface") return;
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    let out = (msg?.parts ?? [])
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
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
    if (!out && !images.length) return;
    if (audience?.kind === "contact") out = guardReply(out);
    if (room) out = quietMentions(out);
    const voice = out && run.state === "completed" ? await voiceFor(run.thread_id, out) : undefined;
    delivery.enqueue({
      channel: to.channel,
      conversation: to.conversation,
      thread_id: run.thread_id,
      kind: "reply",
      body: {
        text: out,
        media: [...images, ...(voice ? [voice] : [])],
        ...(room && to.message ? { reply_to: to.message } : {}),
      },
    });
  }

  /** When the chat asked for spoken answers: the first paragraph as a voice note, shown in the app too. */
  async function voiceFor(threadId: string, text: string) {
    if (!store.threads.context(threadId).voice_replies || !deps.services.hasKind("speech")) return undefined;
    try {
      const m = await deps.services.voiceNote(spokenPart(text), threadId, AbortSignal.timeout(90_000));
      return { id: m.id, kind: "audio" as const, mime: m.mime };
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
    const to = replyTo(threadId);
    const l = to ? live.get(to.channel) : undefined;
    if (!to || !l?.adapter.caps.drafts || !l.adapter.draft) return;
    const msg = store.messages.get(messageId);
    const runId = msg?.run_id;
    if (!runId || msg.author.kind !== "agent") return;
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

  function startTyping(runId: string, threadId: string): void {
    const to = replyTo(threadId);
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
    const to = replyTo(threadId);
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
      if (e.run.state === "working" && e.run.trigger !== "surface") startTyping(e.run.id, e.run.thread_id);
      else if (e.run.state !== "working") stopTyping(e.run.id);
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
        status: (s, error) => {
          l.status = s;
          l.error = error;
          if (s === "running") delivery.kick();
        },
        qr: (code) => {
          l.qr = code;
        },
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
        ...(token ? { token_hint: hintOf(token) } : {}),
        status: l?.status ?? "off",
        ...(l?.error ? { error: l.error } : {}),
        ...(l?.account ? { account: l.account } : {}),
        ...(l?.qr ? { qr: l.qr } : {}),
      };
    });
  }

  /**
   * The owner writing to a contact themselves ("I'll write"): sent as is on the contact's conversation, kept in the
   * chat as the owner's words, and noted for the agent so its next answer knows what was said.
   */
  function sendAsOwner(threadId: string, text: string): void {
    const thread = store.threads.get(threadId);
    const ch = thread?.channel;
    if (!thread || !ch?.person_id || audienceOf(store, thread).kind !== "contact")
      throw new Error("only a contact's chat on a channel can be written to directly");
    const name = audienceOf(store, thread).kind === "contact" ? (store.persons.get(ch.person_id)?.name ?? "them") : "";
    store.tx(() => {
      store.messages.add({
        thread_id: threadId,
        author: { kind: "user", direct: true },
        parts: [{ type: "text", text }],
      });
      store.modelLog.append(threadId, undefined, [
        { role: "user", content: `[Your owner wrote to ${name} directly in this chat:]\n${text}` },
      ]);
      store.threads.patch(threadId, { preview: previewOf(text) });
    });
    delivery.enqueue({
      channel: ch.id,
      conversation: ch.conversation,
      thread_id: threadId,
      kind: "reply",
      body: { text },
    });
  }

  /**
   * A person's profile picture from the first running channel that knows them and shows one, kept as media for a day
   * (a list asks for it on every screen; the platform is asked again only after that).
   */
  async function avatar(personId: string): Promise<string | undefined> {
    const key = `avatar:${personId}`;
    try {
      const was = JSON.parse(store.settings.get(key) ?? "null") as { media?: string; at: number } | null;
      if (was && Date.now() - was.at < AVATAR_TTL_MS && (!was.media || store.media.get(was.media))) return was.media;
    } catch {}
    const person = store.persons.get(personId);
    let asked = false;
    for (const a of person?.addresses ?? []) {
      const l = live.get(a.channel);
      if (!l?.adapter.avatar || l.status !== "running") continue;
      asked = true;
      try {
        const pic = await l.adapter.avatar(a.external_id);
        if (!pic?.data.length) continue;
        const m = deps.services.keep(pic.data, pic.mime);
        store.settings.set(key, JSON.stringify({ media: m.id, at: Date.now() }));
        return m.id;
      } catch {
        // A picture that cannot be read is a list without a face, not an error to show.
      }
    }
    // None shown: not asked again for a day. No channel running: ask again next time.
    if (asked) store.settings.set(key, JSON.stringify({ at: Date.now() }));
    return undefined;
  }

  return {
    info,
    avatar,
    notifyOwner,
    sendAsOwner,
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

const AVATAR_TTL_MS = 24 * 3600_000;

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
    rooms(a) !== rooms(b)
  );
}
