// Voice calls (call-methods.ts). A call is a thread of kind "call" with one agent. APX's voice (services/voice-engine.ts)
// hears and speaks; the model the call talks with runs here (the owner's main model unless they picked another); this
// module writes the call down in its thread and takes what the voice asks to the agent called: a sub-chat nested under
// the call, worked with that agent's own model, shown in the call as a card that settles with the answer.
// See DECISIONS.md#d-227
import crypto from "node:crypto";
import type { CallVoice, Part, VoiceLocale } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { AgentRecord } from "../domain/agents.ts";
import { ownerIdentity } from "../domain/owner.ts";
import { type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { conflict, notFound, unauthorized } from "../errors.ts";
import type { Log } from "../log.ts";
import type { Llm } from "../providers/llm.ts";
import type { ChatItem } from "../providers/types.ts";
import type { AdmitFn } from "./engine.ts";
import { answerOf } from "./run-outcome.ts";

const TICKET_MS = 60_000;
/** One spoken reply: a model that takes longer than this has lost the conversation anyway. */
const THINK_MS = 60_000;
const THINK_MAX_TOKENS = 400;
const MAX_MESSAGES = 80;

/** What the agent is told with every ask: the owner hears its answer read as is. */
const ASK = {
  es: (heard: string, task: string) =>
    `Pedido por voz, en una llamada. Mis palabras, transcritas (pueden tener errores): «${heard}». La voz lo entendió como: ${task}. Respondé en una o dos frases cortas para decir en voz alta: sin listas, links ni formato.`,
  en: (heard: string, task: string) =>
    `Asked by voice, on a call. My words, transcribed (they may have errors): "${heard}". The voice took it as: ${task}. Answer in English in one or two short sentences to be said aloud: no lists, links or formatting.`,
};

/** What the engine tells about the call (the rest of its frames go to the panel untouched). */
export type EngineEvent =
  /** `whole`: the owner's words since the voice last answered, heard again as one: they replace that message. */
  | { type: "heard"; text: string; whole?: boolean }
  | { type: "said"; text: string }
  /** What the owner is saying right now (empty: what was heard is dropped, noise or the voice's own echo). */
  | { type: "partial"; text: string }
  /** The words of the line being spoken so far, as its audio plays. */
  | { type: "saying"; text: string }
  | { type: "turn_end" }
  | { type: "ask"; n: number; task: string; heard?: string }
  | { type: "think"; id: number; messages: unknown }
  | { type: "think_stop"; id: number };

/**
 * What the engine is told about the call: an ask's answer, read to the owner as soon as nobody is talking; and the
 * model's reply as it streams.
 */
export type ToEngine =
  /** `working`: what the agent said on handing the ask on; its result comes later as another result. */
  | { type: "result"; n: number; state: "done" | "failed" | "working"; text: string; by?: string }
  | { type: "thought"; id: number; text: string }
  | { type: "thought_end"; id: number; error?: string }
  /** Words the owner typed in the call's chat, answered aloud as if said. */
  | { type: "typed"; text: string };

type Ask = {
  n: number;
  call: string;
  /** The call it was asked in: a later call in the same chat numbers its asks from 1 again. */
  from: Live;
  sub: string;
  message: string;
  started: number;
  lang: "es" | "en";
};
type Live = {
  thread: string;
  agent: string;
  lang: "es" | "en";
  speaking?: string;
  /** The voice's message text before the line being spoken. */
  spoken: string;
  /** The owner's words in the chat while they still speak (and what the message said before), finished or dropped. */
  hearing?: { id: string; base: string };
  /** The owner's last message, while the voice has said nothing after it: what they say next joins it. */
  owner?: { id: string; text: string };
  send?: (f: ToEngine) => void;
  hangUp?: () => void;
  thinking: Map<number, AbortController>;
};

export type CallTicket = {
  thread: string;
  agent: string;
  voice: CallVoice;
  locale: VoiceLocale;
  until: number;
};

/** A spoken reply's messages as the engine sent them: only plain system, user and assistant text goes to a model. */
function spoken(raw: unknown): ChatItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatItem[] = [];
  // The system prompt always goes: a long call keeps its rules and the [[task:]] protocol.
  const system = raw.filter((m) => (m as { role?: unknown })?.role === "system");
  const rest = raw.filter((m) => (m as { role?: unknown })?.role !== "system").slice(-MAX_MESSAGES);
  for (const m of [...system, ...rest]) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (typeof content !== "string") continue;
    const text = content.slice(0, 20_000);
    if (role === "system") out.push({ role: "system", content: text });
    else if (role === "user") out.push({ role: "user", content: text });
    else if (role === "assistant") out.push({ role: "assistant", content: text });
  }
  return out;
}

export function createCalls(deps: {
  store: Store;
  bus: Bus;
  admit: AdmitFn;
  log: Log;
  llm: Llm;
  /** The models a call talks with, in order: the owner's pick, else their main model. */
  models: () => string[];
  now?: () => number;
}) {
  const { store, log } = deps;
  const now = deps.now ?? Date.now;
  const tickets = new Map<string, CallTicket>();
  let live: Live | undefined;
  /** Asks by the sub-chat that answers them: the agent's turn, and its turns again as what it delegated comes back. */
  const asks = new Map<string, Ask>();

  const boss = () => store.agents.list().find((a) => a.kind === "secretary");
  const callable = (id: string | undefined): AgentRecord => {
    const a = id ? (store.agents.active(id) ? store.agents.get(id) : undefined) : boss();
    if (!a) throw notFound(id ? `agent ${id}` : "super-agent");
    return a;
  };

  function preview(thread: string, text: string) {
    store.threads.patch(thread, { preview: text.slice(0, 200) });
  }

  /** The voice's message of this turn: its sentences go into one message, and the cards of what it asked too. */
  function voiceMessage(l: Live): string {
    if (l.speaking && store.messages.get(l.speaking)) return l.speaking;
    l.owner = undefined;
    l.speaking = store.messages.add({ thread_id: l.thread, author: { kind: "agent", id: l.agent }, parts: [] }).id;
    return l.speaking;
  }

  /** Sets the text of a message's last text part (or adds one), announcing only that part. */
  function setText(messageId: string, text: string) {
    const msg = store.messages.get(messageId);
    if (!msg) return;
    const at = msg.parts.findLastIndex((p) => p.type === "text");
    const last = msg.parts.length - 1;
    if (at >= 0 && at === last) {
      const parts = msg.parts.map((p, i) => (i === at && p.type === "text" ? { ...p, text } : p));
      store.messages.setPart({ ...msg, parts }, at);
    } else store.messages.update({ ...msg, parts: [...msg.parts, { type: "text", text }] });
  }

  function addPart(messageId: string, add: (parts: Part[]) => Part[]) {
    const msg = store.messages.get(messageId);
    if (msg) store.messages.update({ ...msg, parts: add(msg.parts) });
  }

  function ask(l: Live, n: number, task: string, heard: string | undefined) {
    const agent = store.agents.get(l.agent);
    if (!agent) return;
    const sub = store.threads.create({
      kind: "agent",
      title: task.slice(0, 80),
      agent_ids: [agent.id],
      parent_id: l.thread,
    });
    store.threads.mergeContext(sub.id, { titled: true });
    const text = ASK[l.lang](heard?.trim() || task, task);
    store.messages.add({ thread_id: sub.id, author: { kind: "user" }, parts: [{ type: "text", text }] });
    const message = voiceMessage(l);
    addPart(message, (parts) => [
      ...parts,
      { type: "subthread", thread_id: sub.id, agent_id: agent.id, title: task.slice(0, 120), state: "working" },
    ]);
    // The owner's own words, relayed by the voice: the agent's turn is the owner's, with its usual checks and model.
    deps.admit({ thread_id: sub.id, agent_id: agent.id, trigger: "user", origin: { kind: "user" }, text });
    asks.set(sub.id, { n, call: l.thread, from: l, sub: sub.id, message, started: now(), lang: l.lang });
  }

  /**
   * The agent handed the ask to someone whose report comes back to this chat: a delegation, or a task assigned to a
   * teammate. A task only noted down (no assignee, a proposal, a promise, its own) brings nothing back.
   */
  function handedOn(run: RunRecord): boolean {
    const agent = store.agents.get(run.agent_id);
    const self = new Set([run.agent_id, agent?.name.toLowerCase()].filter(Boolean));
    return store.runs.steps(run.id).some((s) => {
      if (s.state !== "ok") return false;
      if (s.tool === "delegate" || s.tool === "workflow") return true;
      if (s.tool !== "task_create") return false;
      const to = typeof s.args.assignee === "string" ? s.args.assignee.trim().toLowerCase() : "";
      return Boolean(to) && !self.has(to) && !s.args.propose && !s.args.owed_by;
    });
  }

  function answered(run: RunRecord) {
    const a = asks.get(run.thread_id);
    if (!a || !TERMINAL.has(run.state)) return;
    const answer = answerOf(store, run)?.trim() ?? "";
    // The agent handed the work on (a task for a teammate, a delegation): what it says now is said, and the call keeps
    // listening to this chat, where the teammate's report wakes it with the result.
    const waiting = run.state === "completed" && handedOn(run);
    if (!waiting) asks.delete(run.thread_id);
    const done = run.state === "completed" && Boolean(answer);
    addPart(a.message, (parts) =>
      parts.map((p) =>
        p.type === "subthread" && p.thread_id === a.sub
          ? {
              ...p,
              state: waiting ? "working" : run.state,
              ...(answer ? { summary: answer.slice(0, 4000) } : {}),
              ms: Math.max(0, now() - a.started),
              ...(run.end_reason ? { end_reason: run.end_reason } : {}),
            }
          : p,
      ),
    );
    if (live === a.from && (answer || !waiting)) {
      // A teammate's report woke the agent: the voice says who finished.
      const origin = run.trigger === "a2a_result" ? run.input?.origin : undefined;
      const by = origin?.kind === "agent" ? origin.name : undefined;
      live.send?.({
        type: "result",
        n: a.n,
        state: waiting ? "working" : done ? "done" : "failed",
        text: answer,
        ...(by ? { by } : {}),
      });
    }
  }

  /** One spoken reply from the call's model, streamed to the engine as it comes. */
  async function think(l: Live, id: number, raw: unknown) {
    const ac = new AbortController();
    l.thinking.set(id, ac);
    let sent = 0;
    const send = (f: ToEngine) => {
      if (live === l) l.send?.(f);
    };
    try {
      const models = deps.models();
      if (!models.length) throw new Error("no model to talk with");
      const r = await deps.llm.complete({
        models,
        messages: spoken(raw),
        tools: [],
        cacheKey: l.thread,
        maxOutputTokens: THINK_MAX_TOKENS,
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(THINK_MS)]),
        onText: (soFar) => {
          // A model that failed over starts again from nothing: only what is new goes down.
          if (soFar.length < sent) sent = 0;
          if (soFar.length > sent) send({ type: "thought", id, text: soFar.slice(sent) });
          sent = soFar.length;
        },
      });
      const full = typeof r.message.content === "string" ? r.message.content : "";
      if (full.length > sent) send({ type: "thought", id, text: full.slice(sent) });
      if (r.usage)
        store.auxCalls.add(
          { purpose: "call", thread_id: l.thread, project_id: store.threads.get(l.thread)?.project_id },
          r.model,
          r.usage,
        );
      send({ type: "thought_end", id });
    } catch (err) {
      if (!ac.signal.aborted) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "call model failed");
        send({ type: "thought_end", id, error: "the model did not answer" });
      }
    } finally {
      l.thinking.delete(id);
    }
  }

  deps.bus.on((e) => {
    if (e.type !== "run.updated" || !asks.has(e.run.thread_id)) return;
    const run = store.runs.get(e.run.id);
    if (run) answered(run);
  });

  return {
    status: () => ({ live: live?.thread }),
    /** Whether a call has a model to talk with. */
    hasModel: () => deps.models().length > 0,

    /** A call's thread (a new one, or the call it goes on in) and the ticket its socket redeems once. */
    start(p: { agent_id?: string | undefined; voice: CallVoice; locale: VoiceLocale; thread?: string | undefined }) {
      if (live) throw conflict("a call is already going on");
      let thread = p.thread ? store.threads.get(p.thread) : undefined;
      if (p.thread && thread?.kind !== "call") throw notFound("call");
      // Calling again from a call's chat calls the same agent.
      const agent = callable(thread?.agent_ids[0] ?? p.agent_id);
      if (!thread) {
        thread = store.threads.create({ kind: "call", title: "Call", agent_ids: [agent.id] });
        store.threads.mergeContext(thread.id, { titled: true });
      }
      for (const [k, t] of tickets) if (t.until < now()) tickets.delete(k);
      const ticket = crypto.randomBytes(24).toString("base64url");
      tickets.set(ticket, {
        thread: thread.id,
        agent: agent.id,
        voice: p.voice,
        locale: p.locale,
        until: now() + TICKET_MS,
      });
      return { thread_id: thread.id, ticket, expires_in: TICKET_MS / 1000 };
    },

    /** The socket's way in: a ticket used once, before it expires. What the engine needs to know about the call. */
    redeem(ticket: string) {
      const t = tickets.get(ticket);
      tickets.delete(ticket);
      if (!t || t.until < now()) throw unauthorized("the call's ticket expired");
      if (live) throw conflict("a call is already going on");
      const agent = callable(t.agent);
      const lang = t.locale === "en-US" ? "en" : "es";
      live = { thread: t.thread, agent: agent.id, lang, thinking: new Map(), spoken: "" };
      log.info({ thread: t.thread, agent: agent.id }, "call started");
      const owner = ownerIdentity(store).name;
      const ownerName = owner || "the owner";
      const isBoss = agent.kind === "secretary";
      return {
        thread: t.thread,
        setup: {
          voice: t.voice,
          locale: t.locale,
          owner,
          agent: agent.name,
          who: isBoss
            ? `${ownerName}'s personal assistant in APX`
            : `one of ${ownerName}'s agents in APX${agent.role ? ` (${agent.role})` : ""}`,
          // What whisper is told to expect: the agents' names, said often on a call.
          names: store.agents
            .list()
            .map((x) => x.name)
            .slice(0, 30)
            .join(", "),
          reach: isBoss
            ? `all of ${ownerName}'s projects, agents, memory, mail, calendar, web and tools`
            : `${agent.name}'s own projects, tools and memory`,
        },
      };
    },

    /** The engine's link for the live call: what it tells is written down, asks go to the agent called. */
    attach(thread: string, send: (f: ToEngine) => void, hangUp: () => void) {
      if (live?.thread !== thread) return;
      live.send = send;
      live.hangUp = hangUp;
    },

    hear(thread: string, e: EngineEvent) {
      const l = live;
      if (!l || l.thread !== thread) return;
      const join = (a: string, b: string) => `${a} ${b}`.trim();
      if (e.type === "partial") {
        // The owner's words show in the chat as they speak, in their last message while the voice has not answered it;
        // empty drops them (noise, or the voice's own echo).
        if (e.text.trim()) {
          if (!l.hearing || !store.messages.get(l.hearing.id)) {
            const last = l.owner && store.messages.get(l.owner.id) ? l.owner : undefined;
            l.hearing = last
              ? { id: last.id, base: last.text }
              : {
                  id: store.messages.add({ thread_id: thread, author: { kind: "user" }, parts: [] }).id,
                  base: "",
                };
          }
          setText(l.hearing.id, join(l.hearing.base, e.text));
        } else if (l.hearing) {
          if (l.hearing.base) setText(l.hearing.id, l.hearing.base);
          else store.messages.drop(thread, [l.hearing.id]);
          l.hearing = undefined;
        }
      } else if (e.type === "heard") {
        if (!e.text.trim()) return;
        l.speaking = undefined;
        l.spoken = "";
        const last = l.owner && store.messages.get(l.owner.id) ? l.owner : undefined;
        const into =
          l.hearing && store.messages.get(l.hearing.id) ? l.hearing : last && { id: last.id, base: last.text };
        const text = e.whole ? e.text : join(into?.base ?? "", e.text);
        const id =
          into?.id ??
          store.messages.add({ thread_id: thread, author: { kind: "user" }, parts: [{ type: "text", text }] }).id;
        if (into) setText(id, text);
        l.owner = { id, text };
        l.hearing = undefined;
        preview(thread, e.text);
      } else if (e.type === "saying" || e.type === "said") {
        // The line being spoken grows word by word with its audio; "said" ends it.
        const fresh = !l.speaking || !store.messages.get(l.speaking);
        const id = voiceMessage(l);
        if (fresh) l.spoken = "";
        const text = `${l.spoken} ${e.text}`.trim();
        setText(id, text);
        if (e.type === "said") {
          l.spoken = text;
          preview(thread, e.text);
        }
      } else if (e.type === "turn_end") {
        l.speaking = undefined;
        l.spoken = "";
      } else if (e.type === "ask") {
        ask(l, e.n, e.task, e.heard);
      } else if (e.type === "think") {
        void think(l, e.id, e.messages);
      } else if (e.type === "think_stop") {
        l.thinking.get(e.id)?.abort();
      }
    },

    /** What the owner typed in the live call's chat: written as theirs and answered aloud. False when not live. */
    typed(thread: string, text: string): boolean {
      const l = live;
      if (!l || l.thread !== thread || !l.send) return false;
      l.speaking = undefined;
      l.spoken = "";
      l.owner = undefined;
      l.hearing = undefined;
      store.messages.add({ thread_id: thread, author: { kind: "user" }, parts: [{ type: "text", text }] });
      preview(thread, text);
      l.send({ type: "typed", text });
      return true;
    },

    /** The call is over (hung up, the socket dropped, the engine stopped). Asks still running finish in their chats. */
    end(thread: string) {
      if (live?.thread !== thread) return;
      const { hangUp, thinking } = live;
      for (const ac of thinking.values()) ac.abort();
      live = undefined;
      log.info({ thread }, "call ended");
      hangUp?.();
    },
  };
}

export type Calls = ReturnType<typeof createCalls>;
