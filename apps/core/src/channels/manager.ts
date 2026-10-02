// Channels: the owner's Telegram bots (later WhatsApp…). This module runs their adapters and sends what goes out:
// the answer of a turn whose last words came from a channel, confirmations with buttons, and notices to the owner.
// What comes in is handled by inbound.ts; sending goes through the durable outbox (delivery.ts).
// See DECISIONS.md#d-014

import type { ChannelInfo, CoreEvent, Part } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { OutboxRow, Presentation } from "../domain/channels.ts";
import { noticePrefs } from "../domain/notices.ts";
import type { NewNotification } from "../domain/notifications.ts";
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
import { inputPresentation, inQuietHours } from "./notices.ts";
import { channelTexts } from "./texts.ts";
import type { AdapterFactory, ChannelAdapter, ChannelConfig } from "./types.ts";

const TYPING_EVERY_MS = 4500;

type Live = {
  config: ChannelConfig;
  adapter: ChannelAdapter;
  ac: AbortController;
  status: ChannelInfo["status"];
  error?: string | undefined;
  account?: string | undefined;
};

const tokenName = (id: string) => `channel-${id}`;

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
}) {
  const { store, secrets, log } = deps;
  const live = new Map<string, Live>();
  const typing = new Map<string, ReturnType<typeof setInterval>>();
  const announced = new Set<string>();
  const escalations = new Map<string, ReturnType<typeof setTimeout>>();
  /** Settings changes of one channel apply one after another (two quick saves never leave two pollers). */
  const changing = new Map<string, Promise<unknown>>();
  let stopped = false;

  function configs(): ChannelConfig[] {
    try {
      return JSON.parse(store.settings.get("channels") ?? "[]") as ChannelConfig[];
    } catch {
      return [];
    }
  }

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
        body: inQuietHours(prefs) ? { ...body, silent: true } : body,
      });
      return true;
    }
    return false;
  }

  const inbound = createInbound({
    store,
    log,
    call: deps.call,
    services: deps.services,
    delivery,
    configs,
    notifyOwner,
    attention: deps.attention,
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
    const voice = out && run.state === "completed" ? await voiceFor(run.thread_id, out) : undefined;
    delivery.enqueue({
      channel: to.channel,
      conversation: to.conversation,
      thread_id: run.thread_id,
      kind: "reply",
      body: { text: out, media: [...images, ...(voice ? [voice] : [])] },
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
    } else if (e.type === "message.part" && e.part.type === "input" && e.part.state === "pending") {
      onInput(e.part, e.thread_id);
    } else if (e.type === "message.created" && e.message.author.kind === "system") {
      // Agents stopped by the breaker: the owner hears it wherever they are.
      const paused = e.message.parts.find((p) => p.type === "notice" && p.code === "breaker.paused");
      if (paused?.type === "notice") notifyOwner({ text: paused.text }, "notice", e.message.thread_id);
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────
  async function startOne(config: ChannelConfig): Promise<void> {
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
        signal: ac.signal,
      });
      l.account = r.account;
      if (l.status === "starting") l.status = "running";
      delivery.kick();
    } catch (err) {
      l.status = "error";
      l.error = errorMessage(err, 300);
      log.warn({ channel: config.id, err: l.error }, "channel did not start");
    }
  }

  async function stopOne(id: string): Promise<void> {
    const l = live.get(id);
    if (!l) return;
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

  function info(): ChannelInfo[] {
    return configs().map((c) => {
      const l = live.get(c.id);
      return {
        ...c,
        token_set: secrets.has(`secret://${tokenName(c.id)}`),
        status: l?.status ?? "off",
        ...(l?.error ? { error: l.error } : {}),
        ...(l?.account ? { account: l.account } : {}),
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

  return {
    info,
    notifyOwner,
    sendAsOwner,
    afterRun,
    /** Adds, changes or removes a channel and (re)starts it. */
    async set(id: string, config: Omit<ChannelConfig, "id"> | null, token?: string): Promise<ChannelInfo[]> {
      await serially(id, async () => {
        if (token) secrets.set(tokenName(id), token);
        const rest = configs().filter((c) => c.id !== id);
        store.settings.set("channels", JSON.stringify(config ? [...rest, { ...config, id }] : rest));
        if (!config) secrets.set(tokenName(id), null);
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
      stopped = true;
      delivery.stop();
      for (const iv of typing.values()) clearInterval(iv);
      for (const t of escalations.values()) clearTimeout(t);
      typing.clear();
      await Promise.allSettled([...live.keys()].map(stopOne));
    },
  };
}

export type Channels = ReturnType<typeof createChannels>;
