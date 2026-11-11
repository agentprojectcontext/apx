// Voice calls (call-methods.ts). A call is a thread of kind "call" with the super-agent. The voice engine
// (services/voice-engine.ts) hears and speaks; this module writes the call down in its thread and takes what the voice
// asks to the super-agent: a sub-chat nested under the call, shown in the call as a card that settles with the answer.
// See DECISIONS.md#d-220
import crypto from "node:crypto";
import type { CallVoice, Part } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { ownerIdentity } from "../domain/owner.ts";
import { type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { conflict, notFound, unauthorized } from "../errors.ts";
import type { Log } from "../log.ts";
import type { AdmitFn } from "./engine.ts";
import { answerOf } from "./run-outcome.ts";

const TICKET_MS = 60_000;
/** What the super-agent is told with every ask: the owner hears its answer read as is. */
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
  | { type: "ask"; n: number; task: string; heard?: string };

/** What the engine is told about the call: an ask's answer, read to the owner as soon as nobody is talking. */
export type ToEngine = { type: "result"; n: number; state: "done" | "failed"; text: string };

type Ask = { n: number; call: string; sub: string; message: string; started: number; lang: "es" | "en" };
type Live = {
  thread: string;
  lang: "es" | "en";
  speaking?: string;
  send?: (f: ToEngine) => void;
  hangUp?: () => void;
};

export function createCalls(deps: { store: Store; bus: Bus; admit: AdmitFn; log: Log; now?: () => number }) {
  const { store, log } = deps;
  const now = deps.now ?? Date.now;
  const tickets = new Map<string, { thread: string; voice: CallVoice; lang: "es" | "en"; until: number }>();
  let live: Live | undefined;
  /** Asks by the super-agent's run that answers them. */
  const asks = new Map<string, Ask>();

  const boss = () => store.agents.list().find((a) => a.kind === "secretary");

  function preview(thread: string, text: string) {
    store.threads.patch(thread, { preview: text.slice(0, 200) });
  }

  /** The voice's message of this turn: its sentences go into one message, and the cards of what it asked too. */
  function voiceMessage(l: Live): string {
    if (l.speaking && store.messages.get(l.speaking)) return l.speaking;
    const agent = boss();
    if (!agent) throw notFound("super-agent");
    l.speaking = store.messages.add({ thread_id: l.thread, author: { kind: "agent", id: agent.id }, parts: [] }).id;
    return l.speaking;
  }

  function addPart(messageId: string, add: (parts: Part[]) => Part[]) {
    const msg = store.messages.get(messageId);
    if (msg) store.messages.update({ ...msg, parts: add(msg.parts) });
  }

  function ask(l: Live, n: number, task: string, heard: string | undefined) {
    const agent = boss();
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
    // The owner's own words, relayed by the voice: the super-agent's turn is the owner's, with its usual checks.
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

  deps.bus.on((e) => {
    if (e.type !== "run.updated" || !asks.has(e.run.id)) return;
    const run = store.runs.get(e.run.id);
    if (run) answered(run);
  });

  return {
    status: () => ({ live: live?.thread }),

    /** A call's thread (a new one, or the call it goes on in) and the ticket its socket redeems once. */
    start(p: { voice: CallVoice; lang?: "es" | "en" | undefined; thread?: string | undefined }) {
      if (live) throw conflict("a call is already going on");
      const agent = boss();
      if (!agent) throw notFound("super-agent");
      const lang = p.lang ?? (ownerIdentity(store).language === "en" ? "en" : "es");
      let thread = p.thread ? store.threads.get(p.thread) : undefined;
      if (p.thread && thread?.kind !== "call") throw notFound("call");
      if (!thread) {
        thread = store.threads.create({ kind: "call", title: "Call", agent_ids: [agent.id] });
        store.threads.mergeContext(thread.id, { titled: true });
      }
      const ticket = crypto.randomBytes(24).toString("base64url");
      tickets.set(ticket, { thread: thread.id, voice: p.voice, lang, until: now() + TICKET_MS });
      return { thread_id: thread.id, ticket, expires_in: TICKET_MS / 1000 };
    },

    /** The socket's way in: a ticket used once, before it expires. */
    redeem(ticket: string) {
      const t = tickets.get(ticket);
      tickets.delete(ticket);
      if (!t || t.until < now()) throw unauthorized("the call's ticket expired");
      if (live) throw conflict("a call is already going on");
      live = { thread: t.thread, lang: t.lang };
      log.info({ thread: t.thread }, "call started");
      return { ...t, owner: ownerIdentity(store).name, agent: boss()?.name ?? "" };
    },

    /** The engine's link for the live call: what it tells is written down, asks go to the super-agent. */
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
      }
    },

    /** The call is over (hung up, the socket dropped, the engine stopped). Asks still running finish in their chats. */
    end(thread: string) {
      if (live?.thread !== thread) return;
      const hangUp = live.hangUp;
      live = undefined;
      log.info({ thread }, "call ended");
      hangUp?.();
    },
  };
}

export type Calls = ReturnType<typeof createCalls>;
