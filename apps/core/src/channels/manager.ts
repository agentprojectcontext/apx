// Channels: the owner's Telegram bots (later WhatsApp…). Inbound: store the message, find who wrote by an exact address
// match, then the owner's words and a contact's go through threads.send (the one door); a stranger gets a pairing
// code. Outbound: the answer of a run that came from a channel, confirmations with buttons, and notices to the owner,
// all through the durable outbox.
// See DECISIONS.md#d-014
import type { ChannelInfo, CoreEvent, MethodName, Params, Result, Thread } from "@apx/protocol";
import { methods } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { Inbound, InboundAction, OutboxRow, Presentation } from "../domain/channels.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { audienceOf } from "../engine/audience.ts";
import { CallError } from "../errors.ts";
import type { Log } from "../log.ts";
import type { CallContext } from "../rpc/context.ts";
import type { Dispatch } from "../rpc/router.ts";
import type { Secrets } from "../secrets.ts";
import { guardReply } from "./guard.ts";
import { type AdapterFactory, type ChannelAdapter, type ChannelConfig, SendError } from "./types.ts";

const MAX_ATTEMPTS = 6;
const TYPING_EVERY_MS = 4500;
const NOT_RUNNING_RETRY_MS = 30_000;

type Live = {
  config: ChannelConfig;
  adapter: ChannelAdapter;
  ac: AbortController;
  status: ChannelInfo["status"];
  error?: string | undefined;
  account?: string | undefined;
};

const tokenName = (id: string) => `channel-${id}`;

const TEXT = {
  es: {
    pairing: (name: string, agent: string, code: string) =>
      `Hola ${name}. Soy ${agent}, un asistente. Antes de seguir, mi dueño tiene que aprobar este chat: pasale el código ${code}.`,
    pairingOwner: (name: string, label: string, code: string) =>
      `${name} quiere hablar por ${label}. Código ${code}. Aprobalo en APX › Canales.`,
    approved: "Aprobado.",
    denied: "Rechazado.",
    answered: (a: string) => `Respondido: ${a}`,
    approve: "Permitir",
    deny: "No",
    asContact: "Aprobar como contacto",
    ignore: "Ignorar",
    failed: (why: string) => `No pude terminar: ${why}`,
  },
  en: {
    pairing: (name: string, agent: string, code: string) =>
      `Hi ${name}. I'm ${agent}, an assistant. Before we go on, my owner needs to approve this chat: give them the code ${code}.`,
    pairingOwner: (name: string, label: string, code: string) =>
      `${name} wants to talk on ${label}. Code ${code}. Approve it in APX › Channels.`,
    approved: "Approved.",
    denied: "Denied.",
    answered: (a: string) => `Answered: ${a}`,
    approve: "Allow",
    deny: "No",
    asContact: "Approve as contact",
    ignore: "Ignore",
    failed: (why: string) => `I couldn't finish: ${why}`,
  },
};

export function createChannels(deps: {
  store: Store;
  secrets: Secrets;
  bus: Bus;
  log: Log;
  factories: Record<string, AdapterFactory>;
  /** The router, late-bound: channel messages enter like any client's. */
  dispatch: () => Dispatch | undefined;
}) {
  const { store, secrets, log } = deps;
  const live = new Map<string, Live>();
  const typing = new Map<string, ReturnType<typeof setInterval>>();
  const announced = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining = false;
  let again = false;

  const text = () => (store.settings.get("owner_language") === "en" ? TEXT.en : TEXT.es);

  function configs(): ChannelConfig[] {
    try {
      return JSON.parse(store.settings.get("channels") ?? "[]") as ChannelConfig[];
    } catch {
      return [];
    }
  }

  async function call<M extends MethodName>(method: M, params: Params<M>, ctx: Partial<CallContext>, key?: string) {
    const dispatch = deps.dispatch();
    if (!dispatch) throw new Error("the router is not ready");
    const r = await dispatch(
      method,
      params,
      { transport: "internal", role: "operator", actor: "human", session: undefined, log, ...ctx },
      methods[method].effect ? (key ?? `channel:${method}:${Date.now()}:${Math.random()}`) : undefined,
    );
    if (!r.ok) throw new CallError(r.error);
    return r.result as Result<M>;
  }

  // ── outbound ──────────────────────────────────────────────────────────
  function enqueue(o: {
    channel: string;
    conversation: string;
    thread_id?: string | undefined;
    kind: OutboxRow["kind"];
    body: Presentation;
  }): void {
    store.channels.outbox.add(o);
    kick();
  }

  function kick(delay = 0): void {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void drain(), delay);
    timer.unref?.();
  }

  async function drain(): Promise<void> {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    try {
      do {
        again = false;
        for (const o of store.channels.outbox.due()) await sendOne(o);
      } while (again && !stopped);
    } finally {
      draining = false;
    }
    const next = store.channels.outbox.nextDue();
    if (next) kick(Math.max(50, Date.parse(next) - Date.now()));
  }

  async function sendOne(o: OutboxRow): Promise<void> {
    const l = live.get(o.channel);
    if (!l) {
      if (!configs().some((c) => c.id === o.channel)) store.channels.outbox.fail(o.id, "failed", "channel removed");
      else store.channels.outbox.retry(o.id, new Date(Date.now() + NOT_RUNNING_RETRY_MS), "channel is off");
      return;
    }
    if (l.status !== "running") {
      store.channels.outbox.retry(o.id, new Date(Date.now() + NOT_RUNNING_RETRY_MS), "channel is not running");
      return;
    }
    if (!store.channels.outbox.claim(o.id)) return;
    try {
      const r = await l.adapter.send(o.conversation, o.body);
      store.channels.outbox.sent(o.id, r.external_id);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      if (err instanceof SendError && err.kind === "retry" && o.attempts + 1 < MAX_ATTEMPTS) {
        const wait = err.retryAfterMs ?? 2000 * 2 ** o.attempts;
        store.channels.outbox.retry(o.id, new Date(Date.now() + wait), msg);
      } else {
        // An error we cannot classify may have happened after the platform took the message.
        const state = err instanceof SendError && err.kind !== "uncertain" ? "failed" : "uncertain";
        store.channels.outbox.fail(o.id, state, msg);
        log.warn({ channel: o.channel, outbox: o.id, err: msg, state }, "channel send did not go through");
      }
    }
  }

  /** Something for the owner, on the first running channel where APX knows their address. */
  function notifyOwner(body: Presentation, kind: OutboxRow["kind"] = "notice"): boolean {
    const preferred = store.settings.get("notices_channel");
    const order = [...live.values()].sort(
      (a, b) => Number(b.config.id === preferred) - Number(a.config.id === preferred),
    );
    for (const l of order) {
      const addr = store.persons.ownerAddress(l.config.id);
      if (addr && l.status === "running") {
        enqueue({ channel: l.config.id, conversation: addr.external_id, kind, body });
        return true;
      }
    }
    return false;
  }

  /** In the app: a notice in the Home chat. */
  function noticeInApp(code: string, textEn: string): void {
    if (!store.threads.get("home")) return;
    store.messages.add({
      thread_id: "home",
      author: { kind: "system" },
      parts: [{ type: "notice", level: "info", code, text: textEn }],
    });
  }

  // ── inbound ───────────────────────────────────────────────────────────
  function receive(channel: string, m: Inbound): void {
    const id = store.channels.inbox.add(channel, m);
    if (id) queueMicrotask(() => void process({ id, channel, payload: m }));
  }

  async function process(row: { id: string; channel: string; payload: Inbound }): Promise<void> {
    try {
      store.channels.inbox.done(row.id, await route(row.channel, row.id, row.payload));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ channel: row.channel, inbox: row.id, err: msg }, "channel message not handled");
      store.channels.inbox.done(row.id, "failed", msg.slice(0, 300));
    }
  }

  /** Who wrote decides where the words go: the owner's thread, a contact's sealed thread, or a pairing code. */
  async function route(channel: string, rowId: string, m: Inbound): Promise<"done" | "ignored"> {
    const cfg = configs().find((c) => c.id === channel);
    // Groups stay off: only one-to-one chats reach an agent.
    if (!cfg || !m.private) return "ignored";
    const person = store.persons.byAddress(cfg.id, m.sender.id);
    if (!person) {
      stranger(cfg, m);
      return "ignored";
    }
    if (person.role === "blocked") return "ignored";
    const owner = person.role === "owner";
    const thread = owner ? ownerThread(cfg, m.conversation) : contactThread(cfg, m.conversation, person);
    if (owner && (await answerPending(thread.id, m.text))) return "done";
    await call(
      "threads.send",
      { thread: thread.id, text: m.text, mode: owner ? cfg.concurrency : "queue" },
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

  function stranger(cfg: ChannelConfig, m: Inbound): void {
    if (cfg.strangers !== "pair") return;
    const { request, fresh } = store.channels.pairing.request({
      channel: cfg.id,
      external_id: m.sender.id,
      conversation: m.conversation,
      name: m.sender.name,
      text: m.text,
    });
    // One code per sender until it expires: a stranger writing again gets no new message.
    if (!fresh) return;
    const t = text();
    const agent = store.agents.get(cfg.agent_id)?.name ?? "APX";
    enqueue({
      channel: cfg.id,
      conversation: m.conversation,
      kind: "pairing",
      body: { text: t.pairing(m.sender.name.slice(0, 40), agent, request.code) },
    });
    notifyOwner({
      text: t.pairingOwner(m.sender.name.slice(0, 40), cfg.label, request.code),
      buttons: [
        { id: `p:${request.code}:contact`, label: t.asContact },
        { id: `p:${request.code}:deny`, label: t.ignore },
      ],
    });
    noticeInApp(
      "pairing.request",
      `${m.sender.name.slice(0, 40)} wants to talk on ${cfg.label}. Code ${request.code}: approve it in Settings → Channels.`,
    );
  }

  function ownerThread(cfg: ChannelConfig, conversation: string): Thread {
    const home = store.threads.get("home");
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

  /** The owner's text answers an open question of that thread, when there is one waiting for words. */
  async function answerPending(threadId: string, words: string): Promise<boolean> {
    const open = store.inputs.pending(threadId).find((i) => i.kind === "question");
    if (!open) return false;
    await call("runs.respond", { input: open.id, text: words }, { actor: "human" });
    return true;
  }

  async function action(channel: string, a: InboundAction): Promise<void> {
    // Only the owner's own address presses buttons that decide things.
    if (store.persons.byAddress(channel, a.sender.id)?.role !== "owner") return;
    const t = text();
    const reply = (s: string) => enqueue({ channel, conversation: a.conversation, kind: "notice", body: { text: s } });
    try {
      const [kind, ref, what] = a.data.split(":");
      if (kind === "i" && ref) {
        const input = store.inputs.get(ref);
        if (input?.state !== "pending") return;
        if (what === "a" || what === "d") {
          await call("runs.respond", { input: ref, decision: what === "a" ? "approve" : "deny" }, { actor: "human" });
          reply(what === "a" ? t.approved : t.denied);
        } else if (what?.startsWith("o")) {
          const choice = input.options?.[Number(what.slice(1))];
          if (choice === undefined) return;
          await call("runs.respond", { input: ref, text: choice }, { actor: "human" });
          reply(t.answered(choice));
        }
      } else if (kind === "p" && ref && (what === "contact" || what === "deny")) {
        await call("pairing.respond", { code: ref, decision: what }, { actor: "human" });
        reply(what === "contact" ? t.approved : t.denied);
      }
    } catch (err) {
      log.warn({ channel, err: err instanceof Error ? err.message : String(err) }, "channel button not handled");
    }
  }

  // ── replies, confirmations, typing ────────────────────────────────────
  const replyTo = (threadId: string) =>
    store.threads.context(threadId).reply_to as { channel: string; conversation: string } | undefined;

  /** A run ended: if the thread's last words came from a channel, the answer goes back there. */
  function afterRun(run: RunRecord): void {
    stopTyping(run.id);
    const to = replyTo(run.thread_id);
    if (!to) return;
    // A turn the owner started in the app answers in the app.
    if ((run.trigger === "user" && run.input?.origin.kind !== "input_answer") || run.trigger === "surface") return;
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    let out = (msg?.parts ?? [])
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
    if (!out && run.state === "failed")
      out = text().failed((run.error ?? "").replace(/^Could not finish: /, "").slice(0, 200));
    if (!out) return;
    const thread = store.threads.get(run.thread_id);
    if (thread && audienceOf(store, thread).kind === "contact") out = guardReply(out);
    enqueue({
      channel: to.channel,
      conversation: to.conversation,
      thread_id: run.thread_id,
      kind: "reply",
      body: { text: out },
    });
  }

  function stopTyping(runId: string): void {
    clearInterval(typing.get(runId));
    typing.delete(runId);
  }

  function onEvent(e: CoreEvent): void {
    if (e.type === "run.updated") {
      const r = e.run;
      if (r.state !== "working") {
        stopTyping(r.id);
        return;
      }
      if (typing.has(r.id) || r.trigger === "user" || r.trigger === "surface") return;
      const to = replyTo(r.thread_id);
      const l = to ? live.get(to.channel) : undefined;
      if (!to || !l?.adapter.caps.typing || !l.adapter.typing) return;
      const ping = () => void l.adapter.typing?.(to.conversation).catch(() => {});
      ping();
      const iv = setInterval(ping, TYPING_EVERY_MS);
      iv.unref?.();
      typing.set(r.id, iv);
      return;
    }
    if (e.type === "message.part" && e.part.type === "input" && e.part.state === "pending") {
      const part = e.part;
      if (announced.has(part.input_id)) return;
      const to = replyTo(e.thread_id);
      const thread = store.threads.get(e.thread_id);
      if (!to || !thread || audienceOf(store, thread).kind !== "owner") return;
      announced.add(part.input_id);
      const t = text();
      const buttons =
        part.kind === "confirm"
          ? [
              { id: `i:${part.input_id}:a`, label: t.approve },
              { id: `i:${part.input_id}:d`, label: t.deny },
            ]
          : (part.options ?? []).slice(0, 8).map((o, i) => ({ id: `i:${part.input_id}:o${i}`, label: o.slice(0, 60) }));
      const body = [part.prompt, part.tool ? `${part.tool}${part.detail ? `: ${part.detail}` : ""}` : ""]
        .filter(Boolean)
        .join("\n");
      enqueue({
        channel: to.channel,
        conversation: to.conversation,
        thread_id: e.thread_id,
        kind: "input",
        body: { text: body.slice(0, 3500), ...(buttons.length ? { buttons } : {}) },
      });
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────
  async function startOne(config: ChannelConfig): Promise<void> {
    const factory = deps.factories[config.type];
    if (!factory || !config.enabled) return;
    const token = secrets.resolve(`secret://${tokenName(config.id)}`);
    const ac = new AbortController();
    const adapter = factory(config, token);
    const l: Live = { config, adapter, ac, status: "starting" };
    live.set(config.id, l);
    try {
      const r = await adapter.start({
        receive: (m) => receive(config.id, m),
        action: (a) => void action(config.id, a),
        status: (s, error) => {
          l.status = s;
          l.error = error;
          if (s === "running") kick();
        },
        signal: ac.signal,
      });
      l.account = r.account;
      if (l.status === "starting") l.status = "running";
      kick();
    } catch (err) {
      l.status = "error";
      l.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      log.warn({ channel: config.id, err: l.error }, "channel did not start");
    }
  }

  async function stopOne(id: string): Promise<void> {
    const l = live.get(id);
    if (!l) return;
    live.delete(id);
    l.ac.abort();
    await l.adapter.stop().catch(() => {});
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

  return {
    info,
    notifyOwner,
    afterRun,
    /** Adds, changes or removes a channel and (re)starts it. */
    async set(id: string, config: Omit<ChannelConfig, "id"> | null, token?: string): Promise<ChannelInfo[]> {
      if (token) secrets.set(tokenName(id), token);
      const rest = configs().filter((c) => c.id !== id);
      store.settings.set("channels", JSON.stringify(config ? [...rest, { ...config, id }] : rest));
      if (!config) secrets.set(tokenName(id), null);
      await stopOne(id);
      const next = configs().find((c) => c.id === id);
      if (next) await startOne(next);
      return info();
    },
    /** Boot: sends cut by a restart become "uncertain", messages not handled yet are handled, channels start. */
    async start(): Promise<void> {
      const cut = store.channels.outbox.reconcile();
      if (cut) log.warn({ items: cut }, "channel sends cut by the last restart are marked uncertain");
      deps.bus.on(onEvent);
      for (const row of store.channels.inbox.pending()) void process(row);
      await Promise.allSettled(configs().map(startOne));
      kick();
    },
    async stop(): Promise<void> {
      stopped = true;
      clearTimeout(timer);
      for (const iv of typing.values()) clearInterval(iv);
      typing.clear();
      await Promise.allSettled([...live.keys()].map(stopOne));
    },
  };
}

export type Channels = ReturnType<typeof createChannels>;
