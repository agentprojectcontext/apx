// Voice calls (call-methods.ts). A call is a thread of kind "call" with one agent. APX's voice (services/voice-engine.ts)
// hears and speaks; the model the call talks with runs here (the owner's main model unless they picked another); this
// module writes the call down in its thread and takes what the voice asks to the agent called: a sub-chat nested under
// the call, worked with that agent's own model, shown in the call as a card that settles with the answer.
// See DECISIONS.md#d-226
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
  | { type: "heard"; text: string }
  | { type: "said"; text: string }
  | { type: "turn_end" }
  | { type: "ask"; n: number; task: string; heard?: string }
  | { type: "think"; id: number; messages: unknown }
  | { type: "think_stop"; id: number };

/**
 * What the engine is told about the call: an ask's answer, read to the owner as soon as nobody is talking; and the
 * model's reply as it streams.
 */
export type ToEngine =
  | { type: "result"; n: number; state: "done" | "failed"; text: string }
  | { type: "thought"; id: number; text: string }
  | { type: "thought_end"; id: number; error?: string };

type Ask = { n: number; call: string; sub: string; message: string; started: number; lang: "es" | "en" };
type Live = {
  thread: string;
  agent: string;
  lang: "es" | "en";
  speaking?: string;
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
  for (const m of raw.slice(-MAX_MESSAGES)) {
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
  /** Asks by the agent's run that answers them. */
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
    l.speaking = store.messages.add({ thread_id: l.thread, author: { kind: "agent", id: l.agent }, parts: [] }).id;
    return l.speaking;
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
    const run = deps.admit({ thread_id: sub.id, agent_id: agent.id, trigger: "user", origin: { kind: "user" }, text });
    asks.set(run.id, { n, call: l.thread, sub: sub.id, message, started: now(), lang: l.lang });
  }

  function answered(run: RunRecord) {
    const a = asks.get(run.id);
    if (!a || !TERMINAL.has(run.state)) return;
    asks.delete(run.id);
    const answer = answerOf(store, run)?.trim() ?? "";
    const done = run.state === "completed" && Boolean(answer);
    addPart(a.message, (parts) =>
      parts.map((p) =>
        p.type === "subthread" && p.thread_id === a.sub
          ? {
              ...p,
              state: run.state,
              ...(answer ? { summary: answer.slice(0, 4000) } : {}),
              ms: Math.max(0, now() - a.started),
              ...(run.end_reason ? { end_reason: run.end_reason } : {}),
            }
          : p,
      ),
    );
    if (live?.thread === a.call) live.send?.({ type: "result", n: a.n, state: done ? "done" : "failed", text: answer });
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
    if (e.type !== "run.updated" || !asks.has(e.run.id)) return;
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
      live = { thread: t.thread, agent: agent.id, lang, thinking: new Map() };
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
      if (e.type === "heard") {
        if (!e.text.trim()) return;
        l.speaking = undefined;
        store.messages.add({ thread_id: thread, author: { kind: "user" }, parts: [{ type: "text", text: e.text }] });
        preview(thread, e.text);
      } else if (e.type === "said") {
        const id = voiceMessage(l);
        addPart(id, (parts) => {
          const last = parts.at(-1);
          return last?.type === "text"
            ? [...parts.slice(0, -1), { ...last, text: `${last.text} ${e.text}`.trim() }]
            : [...parts, { type: "text", text: e.text }];
        });
        preview(thread, e.text);
      } else if (e.type === "turn_end") {
        l.speaking = undefined;
      } else if (e.type === "ask") {
        ask(l, e.n, e.task, e.heard);
      } else if (e.type === "think") {
        void think(l, e.id, e.messages);
      } else if (e.type === "think_stop") {
        l.thinking.get(e.id)?.abort();
      }
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
