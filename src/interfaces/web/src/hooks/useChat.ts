import { useCallback, useEffect, useRef, useState } from "react";
import { SuperAgent, Agents, Conversations, Groups, Turns } from "../lib/api";
import type { ActiveTurn, AgentFace, ChatStreamEvent, ChatUsage, ConversationMessage, MessageMedia, ToolSummary, TurnFrame } from "../types/daemon";
import type { UploadedMedia } from "../lib/api/media";
import { subscribeTurns } from "../lib/live";
import { t } from "../i18n";
import { queueOnSend, onChatPrefsChange } from "../lib/chat-prefs";
import {
  conversationActivityKey,
  isChatTurnClosed,
  liveActivityKey,
  setChatQueued,
  threadActivityKey,
} from "../lib/chat-activity";

export type ToolStatus = "running" | "done" | "error" | "deduped";

export interface ToolPart {
  kind: "tool";
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status: ToolStatus;
}

export interface TextPart {
  kind: "text";
  text: string;
  /** Still being painted by `assistant_delta` tokens. Cleared when the segment
   *  closes (`assistant_text` / `final`) and the cleaned text replaces it. */
  streaming?: boolean;
}

/** The model thinking out loud. Never part of the answer — `textOf` skips it,
 *  so it is not copied, not counted as the reply, and not spoken. */
export interface ReasoningPart {
  kind: "reasoning";
  text: string;
  streaming?: boolean;
}

export type ChatPart = TextPart | ToolPart | ReasoningPart;

export interface ChatMsg {
  role: "user" | "assistant";
  /** Ordered parts of the turn: interleaved assistant text and tool calls. */
  parts: ChatPart[];
  ts: string;
  pending?: boolean;
  /** Model that produced an assistant turn (after routing). */
  model?: string;
  /** Who answered: display name of the agent/persona (Roby, a project agent…). */
  agent?: string;
  /** Stable id of that actor (super_agent | agent slug). Turns are split on it. */
  agentId?: string;
  /** Group only: which agent's @mention pulled this speaker in ("traído por X"). */
  reason?: string;
  /** A group system notice ("joined"/"left") — rendered as a centred line, not a
   *  bubble. `who` is the agent slug it is about. */
  event?: "joined" | "left";
  who?: string;
  /** Token accounting from the `final` event. */
  usage?: ChatUsage;
  /** You stopped this turn. What is here is what it had done — real work, kept
   *  on purpose so the message that interrupted it reads this as its history. */
  stopped?: boolean;
  /** Operational notes (engine fallbacks, retries, suppressions). */
  notes?: string[];
  /** What a HISTORICAL turn did. Live turns render real ToolCall parts from
   *  the stream; replayed ones only have this, recorded at write time. */
  toolSummary?: ToolSummary;
  /** The attachment this user turn carried (voice note, photo, document).
   *  Rendered as the file itself — the stored text is only the marker the
   *  agent was handed. */
  media?: MessageMedia[];
  /** Composed HERE, in this tab, rather than read back from storage.
   *  A reply typed into a Telegram thread goes out on the `web` channel, so the
   *  Telegram thread file will never contain it — and a background refresh that
   *  took the file as the whole truth would erase what you just sent. See
   *  `mergeLocalTurns`. */
  local?: boolean;
  /** Skill Inspector decision for this turn (when the feature is on): which
   *  skills the per-turn RAG loaded inline vs merely hinted. */
  inspector?: {
    embedder?: string;
    loaded?: string[];
    hinted?: string[];
    /** Top matches with their cosine similarity, for the badge popover. */
    scored?: { slug: string; sim: number }[];
  };
}

export interface SendOptions {
  /** Empty / undefined → Auto (router decides). Forwarded as body.model. */
  model?: string;
  /** When set, talk to a project agent (non-streaming) instead of Roby. */
  agentSlug?: string;
  /** Files already stored under ~/.apx/media that this turn carries. The daemon
   *  resolves each path, hands the images to the model and writes the marker
   *  that names them. Super-agent turns only. */
  attachments?: UploadedMedia[];
}

/** A turn written while the previous one was still running.
 *
 *  It is IN the thread from the moment you send it — dimmed, with a way out —
 *  and goes out by itself the moment the running turn lands. Sending during a
 *  run used to be refused outright, which left "stop" as the only thing the
 *  button under a working agent could do: the way to add a sentence to the
 *  conversation was to kill the answer being written. */
export interface QueuedTurn {
  id: string;
  /** The bubble, built exactly like the one a sent turn gets — the marker text
   *  included, so it renders its photo and not the marker's words. */
  msg: ChatMsg;
  /** What actually goes out when its turn comes. */
  text: string;
  opts: SendOptions;
}

// Queue ownership follows the CHAT, not the mounted pane. Navigating away
// destroys ChatTab but must not destroy a message already accepted from the
// composer. The worker that started the active turn drains this map even after
// its component unmounts; a newly mounted pane subscribes and paints it again.
const backgroundQueues = new Map<string, QueuedTurn[]>();
const backgroundQueueListeners = new Set<(key: string) => void>();
let backgroundQueueSeq = 0;

function readBackgroundQueue(key: string | null): QueuedTurn[] {
  return key ? backgroundQueues.get(key) || [] : [];
}

function writeBackgroundQueue(key: string, queue: QueuedTurn[]) {
  if (queue.length) backgroundQueues.set(key, queue);
  else backgroundQueues.delete(key);
  setChatQueued(key, queue.length);
  for (const listener of backgroundQueueListeners) listener(key);
}

function takeBackgroundQueue(key: string): QueuedTurn | null {
  const [next, ...rest] = readBackgroundQueue(key);
  if (!next) return null;
  writeBackgroundQueue(key, rest);
  return next;
}

function moveBackgroundQueue(from: string | null, to: string) {
  if (!from || from === to) return;
  const pending = readBackgroundQueue(from);
  if (!pending.length) return;
  writeBackgroundQueue(from, []);
  writeBackgroundQueue(to, [...readBackgroundQueue(to), ...pending]);
}

export interface ReloadOptions {
  /** A BACKGROUND re-read: the same conversation moved somewhere else and we
   *  are catching up. It must not blank the pane first, must not drop what was
   *  typed here, and must leave the view alone if the fetch fails — none of
   *  which apply when the user actively picked a different chat. */
  silent?: boolean;
}

export interface UseChatResult {
  msgs: ChatMsg[];
  send: (text: string, opts?: SendOptions) => Promise<void>;
  /** Run one GROUP turn: the owner's line fans out to the room as a cascade of
   *  speakers, each streamed into its own pending bubble (name + "traído por X").
   *  `nameOf` resolves a slug to a display name; `rerun` re-runs from a speaker
   *  against the last owner message (`from` = slug, `reason` = who pulled them). */
  sendGroup: (gid: string, text: string, nameOf: (slug: string) => string, opts?: { rerun?: boolean; from?: string; reason?: string | null; media?: UploadedMedia[] }) => Promise<void>;
  stop: () => void;
  clear: (queueKey?: string) => void;
  /** Load a persisted conversation as history and bind subsequent sends to it.
   *  Only supported for project agents (super-agent conversations aren't
   *  persisted per-file). Pass `null` to drop the binding without clearing. */
  load: (agentSlug: string, conversationId: string, opts?: ReloadOptions) => Promise<void>;
  /** Load a super-agent channel thread (telegram/desktop/…) as history. Not
   *  bound to a conversation file — continuing sends go out as fresh web
   *  turns with the thread as previousMessages context. */
  loadThread: (channel: string, threadId: string, opts?: ReloadOptions) => Promise<void>;
  /** Re-run the user turn that produced the assistant message at `index`,
   *  dropping that answer and everything after it (in the pane AND, for a bound
   *  project-agent conversation, on disk). Project-agent / live chats only. */
  regenerate: (index: number, opts?: SendOptions) => Promise<void>;
  /** Replace the user message at `index` with `text` and re-send, dropping that
   *  message and everything after it. Project-agent / live chats only. */
  editAndResend: (index: number, text: string, opts?: SendOptions) => Promise<void>;
  streaming: boolean;
  /** Turns typed while this one was running, in the order they were written.
   *  They belong under the thread, not in `msgs`: everything that paints a live
   *  answer works on the trailing message, and a queued bubble parked there
   *  would silently swallow the rest of the stream. */
  queued: QueuedTurn[];
  /** Take one back before it goes out. */
  unqueue: (id: string) => void;
  /** Conversation id we're bound to, if any. Lets callers reflect "live vs
   *  loaded" state in the UI. */
  conversationId: string | undefined;
  /** What the loaded conversation records about itself — engine, channel — from
   *  its own frontmatter, which is authoritative where a list row's guess is not. */
  conversationMeta: ConversationMeta | undefined;
}

/** Concatenate the text parts of a message (for clipboard). */
export function textOf(msg: ChatMsg): string {
  return msg.parts
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
}

/** Compact line summarising an ask_questions tool call. Surfaced into the
 *  history string we send to the super-agent so the model can see it ALREADY
 *  asked and not re-ask the same questions on the next turn. Without this,
 *  ask_questions calls are invisible in history and the model loops. */
function summarizeAskQuestions(part: ToolPart): string | null {
  const raw = (part.args as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines = raw
    .map((q) => {
      if (typeof q === "string") return `- ${q}`;
      if (!q || typeof q !== "object") return null;
      const qq = q as { question?: unknown; options?: unknown };
      if (typeof qq.question !== "string") return null;
      const opts = Array.isArray(qq.options) ? qq.options : [];
      const optStr = opts
        .map((o) =>
          typeof o === "string"
            ? o
            : o && typeof o === "object" && typeof (o as { label?: unknown }).label === "string"
              ? ((o as { label: string }).label)
              : "",
        )
        .filter((s) => s)
        .join(", ");
      return optStr ? `- ${qq.question} (opciones: ${optStr})` : `- ${qq.question}`;
    })
    .filter((s): s is string => !!s);
  if (lines.length === 0) return null;
  return `[ask_questions]\n${lines.join("\n")}`;
}

/** History view of a message — text parts plus ask_questions summaries.
 *  Used when sending `previousMessages` to the super-agent. */
export function historyTextOf(msg: ChatMsg): string {
  const chunks: string[] = [];
  for (const p of msg.parts) {
    if (p.kind === "text" && p.text) chunks.push(p.text);
    else if (p.kind === "tool" && p.tool === "ask_questions") {
      const s = summarizeAskQuestions(p);
      if (s) chunks.push(s);
    }
  }
  return chunks.join("\n\n").trim();
}

/** Re-send shape for files already on a stored turn (edit / regenerate). */
export function attachmentsOf(msg: ChatMsg): UploadedMedia[] {
  return (msg.media || [])
    .filter((m): m is MessageMedia & { path: string } => typeof m.path === "string" && m.path.length > 0)
    .map((m) => ({
      path: m.path,
      name: m.name || "file",
      mime: m.mime || "application/octet-stream",
      kind: m.kind,
      size: m.size ?? 0,
    }));
}

/** Drop leading `[…]` markers so re-attaching files does not double them. */
function stripLeadingMarkers(text: string, count: number): string {
  let out = text;
  for (let i = 0; i < Math.max(1, count); i++) {
    const next = out.replace(/^\[[^\]]*\]\s*/, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

const userPart = (text: string): ChatPart[] => [{ kind: "text", text }];

/** The stored-turn shape of a file the composer just uploaded. */
const mediaOf = (file: UploadedMedia): MessageMedia => ({
  kind: file.kind,
  path: file.path,
  name: file.name,
  mime: file.mime,
  size: file.size,
  duration: null,
});

/** The markers the daemon will write for these files (see readTurnAttachments),
 *  mirrored locally so the sent turn matches the ledger after a silent reload.
 *  A short `[image attached]` used to diverge from `[image attached — saved to
 *  …]` and leave the optimistic bubble dangling as a duplicate photo. */
const markersFor = (files: UploadedMedia[]): string =>
  files
    .map((f) =>
      f.kind === "photo"
        ? `[image attached — saved to ${f.path}]`
        : `[file attached: ${f.name}, ${f.mime} — saved to ${f.path}. You can open it with your file tools.]`,
    )
    .join(" ");

function isErrorResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  return "error" in r && !!r.error;
}

/** Reconstruct chat turns from a persisted channel thread (global ledger).
 *  User rows start a new turn; consecutive assistant/tool rows collapse into a
 *  single assistant bubble with interleaved text + tool parts — mirroring how a
 *  live streamed turn is shaped, so tool executions render the same on reload as
 *  they did in real time. Persisted rows carry no live status, so it's derived
 *  from the stored result (error → "error", else "done").
 *
 *  A change of ACTOR also breaks the bubble: if Roby answers and then a project
 *  agent does, they're two turns, not one — otherwise the footer would credit
 *  the whole block to whichever one happened to be last. Token usage is summed
 *  across the rows of a turn (streamed channels write several agent rows and
 *  only the final one carries `usage`). */
function threadToChatMsgs(messages: ConversationMessage[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  let turn: ChatMsg | null = null;
  let turnActor: string | undefined;
  let toolSeq = 0;
  for (const m of messages) {
    const ts = m.ts || new Date().toISOString();
    if (m.role === "user") {
      turn = null;
      turnActor = undefined;
      // A stored turn records ONE file (the ledger row holds a single media
      // block) — the live turn below can carry several, so the field is a list
      // either way and history just has a list of one.
      out.push({ role: "user", parts: userPart(m.content), ts, ...(m.media ? { media: [m.media] } : {}) });
    } else if (m.role === "assistant" || m.role === "tool") {
      // Tool rows inherit the current actor (they're logged by whoever is
      // running); only assistant rows can start a new one.
      //
      // A turn OPENED by tool rows has no actor yet, and the assistant row that
      // follows is the one that names it — not a second turn. Comparing against
      // an undefined actor split every "tools first, then the answer" turn in
      // two: the calls in a bubble credited to nobody, the answer in another.
      // That is what kept the question panel from ever appearing — the
      // ask_questions call ended up one bubble BEHIND the last message, so the
      // questions read as already answered and there was nothing to pick from.
      const actor = m.role === "assistant" ? m.agent : turnActor;
      const named = turnActor !== undefined;
      if (!turn || (m.role === "assistant" && named && actor !== turnActor)) {
        turn = { role: "assistant", parts: [], ts };
        turnActor = actor;
        out.push(turn);
      } else if (m.role === "assistant" && !named) {
        turnActor = actor;
      }
      if (m.role === "tool") {
        turn.parts.push({
          kind: "tool",
          id: `hist-${toolSeq++}`,
          tool: m.tool || "tool",
          args: m.args,
          result: m.result,
          status: isErrorResult(m.result) ? "error" : "done",
        });
      } else {
        if (m.agent) turn.agentId = m.agent;
        if (m.agent_name) turn.agent = m.agent_name;
        if (m.reason) turn.reason = m.reason; // group: "traído por X"
        if (m.model) turn.model = m.model;
        if (m.tool_summary) turn.toolSummary = m.tool_summary;
        if (m.skill_inspector) turn.inspector = m.skill_inspector;
        // What the AGENT sent with this turn — a skill's image it attached, a
        // photo it pushed to Telegram, a file a routine delivered. The stored
        // row always carried it; this branch simply never read it, so an agent
        // could hand you a file and the thread would show the caption alone.
        // `media_list` is the several-file spelling a delivery writes; the flat
        // one mirrors its first file, so the list wins where both are present.
        const sent = m.media_list?.length ? m.media_list : m.media ? [m.media] : [];
        if (sent.length) turn.media = [...(turn.media || []), ...sent];
        if (m.usage) {
          turn.usage = {
            input_tokens: (turn.usage?.input_tokens || 0) + (m.usage.input_tokens || 0),
            output_tokens: (turn.usage?.output_tokens || 0) + (m.usage.output_tokens || 0),
          };
        }
        // The thinking first, the answer after — the order it happened in and
        // the order the live stream paints it.
        for (const think of m.reasoning || []) {
          if (think) turn.parts.push({ kind: "reasoning", text: think });
        }
        if (m.content) turn.parts.push({ kind: "text", text: m.content });
      }
    } else if (m.role === "system" && m.event) {
      // A group join/leave notice — a standalone centred line, not part of any
      // agent's turn.
      turn = null;
      turnActor = undefined;
      out.push({ role: "assistant", parts: [], ts, event: m.event, who: m.who });
    }
    // other system/compact rows are context-only; not rendered in the viewer.
  }
  return out;
}

/**
 * Reconcile a background re-read with what this tab composed itself.
 *
 * Storage wins for everything it knows about — it is the record, and it now
 * holds whatever the other device just said. But a turn typed HERE may not be
 * in the file we just read: a reply sent while reading a Telegram thread goes
 * out on the `web` channel, so the Telegram day file will never contain it, and
 * taking the file as the whole truth would make what you just sent vanish.
 *
 * Local turns that DID land in storage are matched by role + text OR by the
 * same attachment path (media markers used to diverge between optimistic and
 * ledger text, which left a duplicate photo at the foot of the thread until
 * a hard reload) and dropped, so the same turn is never shown twice.
 */
function mediaPathsKey(m: ChatMsg): string {
  return (m.media || []).map((x) => x.path).filter(Boolean).join("\0");
}

export function mergeLocalTurns(remote: ChatMsg[], current: ChatMsg[]): ChatMsg[] {
  const extras = current.filter((m) => m.local);
  if (!extras.length) return remote;
  const seenText = new Set(remote.map((m) => `${m.role}|${textOf(m)}`));
  const seenMedia = new Set(
    remote.filter((m) => mediaPathsKey(m)).map((m) => `${m.role}|${mediaPathsKey(m)}`),
  );
  return [
    ...remote,
    ...extras.filter((m) => {
      if (seenText.has(`${m.role}|${textOf(m)}`)) return false;
      const paths = mediaPathsKey(m);
      if (paths && seenMedia.has(`${m.role}|${paths}`)) return false;
      return true;
    }),
  ];
}

/** History plus a trailing streaming bubble for a turn still being written, so
 *  opening a chat mid-answer shows the partial (then the live frames fill it).
 *  Marked local so a background refetch keeps it until the real turn persists. */
function withActiveTurn(loaded: ChatMsg[], active?: ActiveTurn | null): ChatMsg[] {
  if (!active) return loaded;
  const parts: ChatPart[] = active.parts?.length
    ? active.parts.map((part) => part.kind === "text"
      ? { kind: "text", text: part.text, ...(part.streaming ? { streaming: true } : {}) }
      : {
          kind: "tool",
          id: part.id,
          tool: part.tool,
          args: part.args || undefined,
          result: part.result,
          status: part.status,
        })
    : active.text ? [{ kind: "text", text: active.text, streaming: true }] : [];
  return [
    ...loaded,
    {
      role: "assistant",
      parts,
      ts: active.started_at || new Date().toISOString(),
      local: true,
      pending: true,
      ...(active.agent_slug ? { agent: active.agent_slug, agentId: active.agent_slug } : {}),
    },
  ];
}

/**
 * Pure reducer: apply one NDJSON stream event to an assistant turn and return
 * the next turn. Every surface that consumes the super-agent stream (ChatTab,
 * the floating Roby sheet) uses this so the rich rendering — interleaved text,
 * collapsible tool calls, routing notes, usage — stays identical everywhere.
 *
 * The `error` and stream-close events are NOT handled here (callers decide how
 * to surface failures and finalise `pending`); everything that mutates the
 * turn's content lives here.
 */
export function applyStreamEvent(turn: ChatMsg, ev: ChatStreamEvent): ChatMsg {
  const withNote = (note: string): ChatMsg => ({ ...turn, notes: [...(turn.notes || []), note] });
  switch (ev.type) {
    case "model_start":
      return ev.model ? { ...turn, model: ev.model } : turn;
    case "model_routed": {
      const next = ev.model ? { ...turn, model: ev.model } : turn;
      return ev.from_fallback
        ? { ...next, notes: [...(next.notes || []), `routing fell back → ${ev.model}`] }
        : next;
    }
    case "engine_failed":
      return withNote(`engine ${ev.model || "?"} failed → ${ev.retry_with || "retry"}`);
    case "model_retry":
      return withNote(`retry (${ev.reason || "?"})`);
    case "tools_suppressed":
      return withNote(`tools suppressed: ${(ev.tools || []).join(", ")}`);
    case "skill_inspector": {
      const insp = ev.inspector;
      // Keep the row when anything was injected OR merely scored: the "considered"
      // near-misses are shown each round too, so the per-turn RAG is visible even
      // when nothing crossed the load/hint bar (e.g. on the offline tf embedder).
      if (!insp || (!insp.loaded?.length && !insp.hinted?.length && !insp.scored?.length))
        return turn;
      return {
        ...turn,
        inspector: {
          embedder: insp.embedder,
          loaded: insp.loaded || [],
          hinted: insp.hinted || [],
          scored: insp.scored || [],
        },
      };
    }
    case "assistant_reasoning_delta": {
      // The thinking, live. Fills the wait before the first word of the answer.
      const piece = ev.reasoning || "";
      if (!piece) return turn;
      const parts = [...turn.parts];
      const last = parts[parts.length - 1];
      if (last && last.kind === "reasoning" && last.streaming) {
        parts[parts.length - 1] = { ...last, text: last.text + piece };
      } else {
        parts.push({ kind: "reasoning", text: piece, streaming: true });
      }
      return { ...turn, parts };
    }
    case "assistant_reasoning": {
      // The whole block at once — the loop emits it after the call returns, so
      // by now the answer may already be painted below the streamed thinking.
      const full = ev.reasoning || "";
      if (!full) return turn;
      const parts = [...turn.parts];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.kind === "reasoning" && p.streaming) {
          parts[i] = { kind: "reasoning", text: full };
          return { ...turn, parts };
        }
      }
      // An engine that never streamed it: the thinking happened BEFORE the
      // answer, so it goes in front of the segment being written, not after.
      const last = parts[parts.length - 1];
      const at = last && last.kind === "text" && last.streaming ? parts.length - 1 : parts.length;
      parts.splice(at, 0, { kind: "reasoning", text: full });
      return { ...turn, parts };
    }
    case "assistant_text": {
      // The cleaned close of the segment the deltas were painting. It REPLACES
      // the streamed part — appending it would show the same answer twice, once
      // token by token and once whole.
      if (!ev.text) return turn;
      const parts = [...turn.parts];
      const last = parts[parts.length - 1];
      if (last && last.kind === "text" && last.streaming) {
        parts[parts.length - 1] = { kind: "text", text: ev.text };
        return { ...turn, parts };
      }
      return { ...turn, parts: [...parts, { kind: "text", text: ev.text }] };
    }
    case "tool_start":
      return ev.trace
        ? {
            ...turn,
            parts: [
              ...turn.parts,
              {
                kind: "tool",
                id: ev.trace.id,
                tool: ev.trace.tool,
                args: ev.trace.args,
                status: "running",
              },
            ],
          }
        : turn;
    case "tool_deduped":
      return ev.trace
        ? {
            ...turn,
            parts: turn.parts.map((p) =>
              p.kind === "tool" && p.id === ev.trace!.id ? { ...p, status: "deduped" } : p,
            ),
          }
        : turn;
    case "tool_result":
      if (!ev.trace) return turn;
      {
        const errored = isErrorResult(ev.trace.result);
        return {
          ...turn,
          parts: turn.parts.map((p) =>
            p.kind === "tool" && p.id === ev.trace!.id
              ? {
                  ...p,
                  result: ev.trace!.result,
                  status: errored ? "error" : p.status === "deduped" ? "deduped" : "done",
                }
              : p,
          ),
        };
      }
    case "final": {
      // The closing message. It only counts as "already shown" when it IS one
      // of the streamed segments — the guard used to be "the turn has any text
      // at all", which silently dropped every answer that came after a tool
      // call. Since the model writes a line before each tool, that was every
      // multi-step turn: the reader saw the steps and never the conclusion.
      // (api/code.js fixed the same bug on the persistence side.)
      const finalText = ev.result?.text || "";
      const parts = [...turn.parts];
      const last = parts[parts.length - 1];
      // A part still marked streaming holds raw tokens; `final` carries the
      // cleaned version of that same text, so it lands in place.
      if (finalText && last && last.kind === "text" && last.streaming) {
        parts[parts.length - 1] = { kind: "text", text: finalText };
      }
      const alreadyShown =
        !!finalText &&
        parts.some((p) => p.kind === "text" && p.text.trim() === finalText.trim());
      return {
        ...turn,
        pending: false,
        usage: ev.result?.usage ?? turn.usage,
        // `model` is the engine (from model_start/model_routed, or the final
        // event); `name` is the persona that answered — they are not the same
        // thing and must not fall back to each other.
        model: turn.model ?? ev.result?.model,
        agent: turn.agent ?? ev.result?.name,
        parts:
          finalText && !alreadyShown
            ? [...parts, { kind: "text", text: finalText }]
            : parts,
      };
    }
    case "start":
      // Identity only (which conversation / channel this turn is on). The pane
      // binds to it outside the reducer — nothing about the bubble changes.
      return turn;
    case "aborted": {
      // You stopped it. Everything streamed so far stands: it is work that
      // really happened, the daemon persisted it, and the message that
      // interrupted this turn reads it as history. So the only thing to do is
      // close the open segment — no text is thrown away, and this is NOT an
      // error, which is why it does not travel as one.
      return {
        ...turn,
        pending: false,
        stopped: true,
        parts: turn.parts.map((p) =>
          p.kind === "text" && p.streaming ? { kind: "text", text: p.text } : p,
        ),
      };
    }
    default: {
      // `assistant_delta` — tokens as the model writes them. They only ever
      // extend a part that is still streaming; a segment already closed by
      // assistant_text is finished and must not absorb the next one's tokens.
      const piece = ev.delta || ev.content || "";
      if (!piece) return turn;
      const parts = [...turn.parts];
      const last = parts[parts.length - 1];
      if (last && last.kind === "text" && last.streaming) {
        parts[parts.length - 1] = { ...last, text: last.text + piece };
      } else {
        parts.push({ kind: "text", text: piece, streaming: true });
      }
      return { ...turn, parts };
    }
  }
}

/** What a stored conversation records about itself (its frontmatter). */
export interface ConversationMeta {
  engine?: string;
  channel?: string;
  title?: string;
  started?: string;
  /** Multi-agent threads (a2a, group) only: who is in the room, and the face
   *  each one wears. Both come resolved from the daemon with the messages, so
   *  the header can draw the thread without being handed a list row — which is
   *  all the project Chats tab ever had, and why it drew none. */
  participants?: string[];
  faces?: AgentFace[];
}

function metaFromDetail(detail: { channel?: string; meta?: Record<string, unknown> }): ConversationMeta {
  const fm = (detail.meta || {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    engine: str(fm.engine),
    channel: str(fm.channel) || detail.channel,
    title: str(fm.title)?.replace(/^"|"$/g, ""),
    started: str(fm.started),
  };
}

/**
 * Single source of truth for the project chat. For Roby (super-agent) it
 * consumes the NDJSON event stream and builds a rich, opencode-style turn:
 * interleaved assistant text and tool calls (with args + results), plus model
 * routing notes and token usage. For a named project agent it falls back to
 * the blocking `Agents.chat` call (those are direct LLM calls with no tools).
 */
export function useChat(pid: string, onError?: (msg: string) => void): UseChatResult {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const msgsRef = useRef<ChatMsg[]>([]);
  // React drops state updates after unmount. The request does not stop, so keep
  // the worker's own copy synchronously: a background queue needs the answer
  // that just finished when it builds the next turn's history.
  const updateMsgs = useCallback((next: ChatMsg[] | ((curr: ChatMsg[]) => ChatMsg[])) => {
    const value = typeof next === "function" ? next(msgsRef.current) : next;
    msgsRef.current = value;
    setMsgs(value);
  }, []);
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const updateStreaming = useCallback((value: boolean) => {
    streamingRef.current = value;
    setStreaming(value);
  }, []);
  // A turn opened from another pane is busy too, but it is followed through the
  // shared feed instead of this hook's NDJSON response.
  const [following, setFollowing] = useState(false);
  const followingRef = useRef(false);
  const updateFollowing = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  }, []);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  // What the LOADED conversation says about itself — its engine, its channel —
  // read from the file's own frontmatter rather than from whatever the list row
  // guessed. A routine conversation opened from the sidebar was labelled "new
  // chat · web" and showed no model at all, because the header only ever saw
  // the selection metadata.
  const [conversationMeta, setConversationMeta] = useState<ConversationMeta | undefined>(undefined);
  // Written during a run, waiting their turn. Deliberately their own state and
  // not a flag on a `msgs` entry: `patchLast` and the two error paths below all
  // address the LAST message, so a queued bubble sitting there would take the
  // rest of the stream, or be the thing a failed turn deleted.
  const [queued, setQueued] = useState<QueuedTurn[]>([]);
  const queueKeyRef = useRef<string | null>(null);
  const bindQueue = useCallback((key: string) => {
    queueKeyRef.current = key;
    const snapshot = readBackgroundQueue(key);
    setQueued(snapshot);
    setChatQueued(key, snapshot.length);
  }, []);
  useEffect(() => {
    const listener = (key: string) => {
      if (key === queueKeyRef.current) setQueued(readBackgroundQueue(key));
    };
    backgroundQueueListeners.add(listener);
    return () => { backgroundQueueListeners.delete(listener); };
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  // How the DAEMON addresses the turn this tab started, so it can be stopped for
  // real. abortRef only closes our socket, which the daemon deliberately ignores
  // (that is what lets another tab catch up on a running turn) — the run itself
  // stops only when asked, through POST /turns/abort.
  const turnTargetRef = useRef<{ conversation_id?: string; channel?: string; thread_id?: string } | null>(null);
  const convoRef = useRef<string | undefined>(undefined);
  const threadRef = useRef<{ channel: string; id: string } | null>(null);
  // Monotonic token guarding async history loads. Every load()/loadThread()/
  // clear() bumps it; a load only applies its result if it's still the latest.
  // Without this, clicking chat A then B could land A's (slower) response last
  // and paint A's messages under B's header.
  const loadSeqRef = useRef(0);
  // A running request belongs to the chat it started in, not whichever chat
  // the owner opens next. Loading another chat advances this epoch: the old
  // request continues in the daemon, but its late NDJSON frames cannot append
  // themselves to the newly selected transcript.
  const viewEpochRef = useRef(0);
  // True while THIS tab is the one streaming a turn over its own NDJSON socket.
  // The sender renders from that; it must ignore the live-turn frames the daemon
  // also pushes for everyone else, or it would paint each token twice.
  // Updated synchronously by updateStreaming; no render/effect round trip, so a
  // send in the same tick cannot start a second run.
  // Interrupt or wait, when you write during a running turn. Held in a ref so
  // flipping the switch mid-turn takes effect on the very next send instead of
  // rebuilding `send` and its captured history.
  const queueOnSendRef = useRef(queueOnSend());
  useEffect(() => {
    const read = () => { queueOnSendRef.current = queueOnSend(); };
    read();
    return onChatPrefsChange(read);
  }, []);
  // The turn this tab is FOLLOWING from the live feed (a turn it did not start):
  // its id and the text accumulated so far, so a frame that arrives after a
  // background refetch wiped the bubble can repaint it whole rather than lose it.
  const liveTurnRef = useRef<{ id: string; text: string } | null>(null);
  const drainQueueRef = useRef<() => void>(() => {});
  const beginViewChange = useCallback(() => {
    viewEpochRef.current++;
    // Detach this pane from a turn that is still running elsewhere. The daemon
    // and shared feed keep it alive; this chat must not inherit its typing pill.
    updateStreaming(false);
    updateFollowing(false);
    liveTurnRef.current = null;
    turnTargetRef.current = null;
  }, [updateFollowing, updateStreaming]);

  // Mutate the trailing assistant turn in place.
  const patchLast = useCallback((fn: (m: ChatMsg) => ChatMsg) => {
    updateMsgs((curr) => {
      const copy = [...curr];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant") copy[copy.length - 1] = fn(last);
      return copy;
    });
  }, [updateMsgs]);

  const applyEvent = useCallback(
    (ev: ChatStreamEvent) => {
      if (ev.type === "error") {
        onError?.(ev.error || t("shared_ui.err_stream"));
        return;
      }
      // The turn names itself before it does any work, so stopping it (or
      // interrupting it by sending) works from the first token — not only once
      // it is over, which is when `final` used to be the first mention of the
      // conversation it had been writing to all along.
      if (ev.type === "start") {
        if (ev.conversation_id) {
          const nextKey = conversationActivityKey(pid, ev.conversation_id);
          moveBackgroundQueue(queueKeyRef.current, nextKey);
          bindQueue(nextKey);
          convoRef.current = ev.conversation_id;
          threadRef.current = null;
          setConversationId(ev.conversation_id);
          turnTargetRef.current = { conversation_id: ev.conversation_id };
        } else if (ev.channel) {
          const threadId = ev.thread_id || new Date().toISOString().slice(0, 10);
          bindQueue(threadActivityKey(pid, ev.channel, threadId));
          threadRef.current = { channel: ev.channel, id: threadId };
          turnTargetRef.current = { channel: ev.channel };
        }
      }
      // Stopped by you. Mark it the same way the local-abort path does, so the
      // two routes to the same outcome read identically in the thread.
      if (ev.type === "aborted") {
        patchLast((m) => {
          const closed = applyStreamEvent(m, ev);
          return { ...closed, parts: [...closed.parts, { kind: "text", text: t("code_module.stopped") }] };
        });
        return;
      }
      patchLast((m) => applyStreamEvent(m, ev));
    },
    [pid, patchLast, onError, bindQueue],
  );

  // ── Following a turn this tab did NOT start (live push) ──────────────────
  // paintLive upserts a trailing STREAMING assistant bubble (local, so a
  // background refetch keeps it) from the full accumulated text; finalizeLive
  // turns it into a settled reply (no longer local, so the next silent reload
  // replaces it with the identical persisted turn instead of doubling it).
  const paintLive = useCallback((text: string, agentSlug?: string) => {
    updateMsgs((curr) => {
      const copy = [...curr];
      const last = copy[copy.length - 1];
      const base: ChatMsg = {
        role: "assistant",
        parts: text ? [{ kind: "text", text, streaming: true }] : [],
        ts: new Date().toISOString(),
        local: true,
        pending: true,
        ...(agentSlug ? { agent: agentSlug, agentId: agentSlug } : {}),
      };
      if (last && last.role === "assistant" && (last.pending || last.local)) {
        copy[copy.length - 1] = { ...base, ts: last.ts };
      } else {
        copy.push(base);
      }
      return copy;
    });
  }, [updateMsgs]);

  const finalizeLive = useCallback(
    (text: string, opts: { model?: string; name?: string; usage?: ChatUsage; error?: string }) => {
      updateMsgs((curr) => {
        const copy = [...curr];
        const last = copy[copy.length - 1];
        if (!last || last.role !== "assistant") return curr;
        copy[copy.length - 1] = {
          ...last,
          local: false,
          pending: false,
          parts: text
            ? [{ kind: "text", text }]
            : opts.error
              ? [{ kind: "text", text: t("shared_ui.err_stream") }]
              : last.parts,
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.name ? { agent: opts.name, agentId: opts.name } : {}),
          ...(opts.usage ? { usage: opts.usage } : {}),
        };
        return copy;
      });
    },
    [updateMsgs],
  );

  // The daemon pushes every in-progress turn's tokens over the shared feed. A
  // tab that is NOT the sender — a second window, or this one after a refresh /
  // switching chats and back — follows them here, so streaming survives losing
  // the connection that started it.
  const onTurnFrame = useCallback((f: TurnFrame) => {
    if (streamingRef.current) return;                 // the sender renders via NDJSON
    if (String(f.project_id) !== String(pid)) return;
    const sameConversation = !!convoRef.current && f.conversation_id === convoRef.current;
    const sameThread = !!threadRef.current &&
      f.channel === threadRef.current.channel &&
      f.thread_id === threadRef.current.id;
    if (!sameConversation && !sameThread) return;
    if (f.phase === "start") {
      updateFollowing(true);
      turnTargetRef.current = sameConversation
        ? { conversation_id: f.conversation_id || undefined }
        : { channel: f.channel || undefined };
      liveTurnRef.current = { id: f.turn_id, text: "" };
      paintLive("", f.agent_slug || undefined);
    } else if (f.phase === "delta") {
      const cur =
        liveTurnRef.current && liveTurnRef.current.id === f.turn_id
          ? liveTurnRef.current
          : (liveTurnRef.current = { id: f.turn_id, text: "" });
      cur.text += f.delta || "";
      paintLive(cur.text, f.agent_slug || undefined);
    } else if (f.phase === "final") {
      liveTurnRef.current = null;
      updateFollowing(false);
      finalizeLive(f.result?.text ?? "", {
        model: f.result?.model,
        name: f.result?.name || f.agent_slug || undefined,
        usage: f.result?.usage,
      });
      turnTargetRef.current = null;
      queueMicrotask(() => drainQueueRef.current());
    } else if (f.phase === "aborted") {
      liveTurnRef.current = null;
      updateFollowing(false);
      finalizeLive(f.result?.text ?? "", {
        model: f.result?.model,
        name: f.result?.name || f.agent_slug || undefined,
        usage: f.result?.usage,
      });
      turnTargetRef.current = null;
      queueMicrotask(() => drainQueueRef.current());
    } else if (f.phase === "error") {
      liveTurnRef.current = null;
      updateFollowing(false);
      finalizeLive("", { error: f.error });
      turnTargetRef.current = null;
      queueMicrotask(() => drainQueueRef.current());
    }
  }, [pid, paintLive, finalizeLive, updateFollowing]);

  useEffect(() => subscribeTurns(onTurnFrame), [onTurnFrame]);

  /**
   * Stop the turn the DAEMON is running, not just the socket we read it through.
   *
   * Closing the stream has never stopped a run and must not start to: another
   * tab, or this one after a refresh, catches up on a turn in progress from the
   * daemon's own copy (see active-turns.js). So the ask is explicit, and the
   * daemon answers by closing the stream with `aborted` — which carries the
   * partial and is not an error.
   *
   * The local abort is the fallback for the two cases the daemon cannot answer:
   * there is no live turn under that key (it finished a moment before the click
   * landed), or the request itself failed.
   */
  const stopTurn = useCallback(async () => {
    const target = turnTargetRef.current;
    if (target) {
      try {
        const { aborted } = await Turns.abort(pid, target);
        if (aborted) return;
      } catch {
        /* the daemon could not be asked — fall through and at least stop reading */
      }
    }
    abortRef.current?.abort();
  }, [pid]);

  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      const trimmed = text.trim();
      const files = opts.attachments || [];
      // A photo with no caption is a turn; text alone still is one.
      if (!trimmed && !files.length) return;
      const nowIso = () => new Date().toISOString();
      // The bubble a turn gets, whether it goes out now or in a minute. The
      // marker rides on the turn's text the way it does on every other channel:
      // the bubble strips it (the file is shown instead) and the NEXT turn's
      // history still records that something was attached.
      const bubble = (): ChatMsg => ({
        role: "user",
        parts: userPart([markersFor(files), trimmed].filter(Boolean).join(" ")),
        ts: nowIso(),
        // Composed here: a background refresh keeps it even when the thread
        // being read is not the channel this turn goes out on.
        local: true,
        ...(files.length ? { media: files.map(mediaOf) } : {}),
      });

      // Written while the previous turn was still going. It joins the thread
      // now and leaves on its own when the run lands — refusing it is what made
      // "stop" the only button a working agent would show you.
      if (streamingRef.current || followingRef.current) {
        // Queued either way — the drain effect below is what actually sends it,
        // once the pane is free and its history includes whatever the running
        // turn wrote. The preference only decides whether we WAIT for that turn
        // or cut it short.
        const key = queueKeyRef.current || (
          opts.agentSlug
            ? liveActivityKey(pid, opts.agentSlug)
            : threadActivityKey(pid, "web", new Date().toISOString().slice(0, 10))
        );
        bindQueue(key);
        writeBackgroundQueue(key, [
          ...readBackgroundQueue(key),
          { id: `q${++backgroundQueueSeq}`, text: trimmed, opts, msg: bubble() },
        ]);
        // Interrupt, by default: writing while an agent works almost always
        // means "no, stop, do this instead", which is what a new message has
        // always done on Telegram. Whatever the turn had written stays in the
        // thread, so this lands as a redirection of work in progress rather
        // than a fresh start.
        if (!queueOnSendRef.current) void stopTurn();
        return;
      }

      if (!queueKeyRef.current) {
        bindQueue(
          opts.agentSlug
            ? liveActivityKey(pid, opts.agentSlug)
            : threadActivityKey(pid, "web", new Date().toISOString().slice(0, 10)),
        );
      }

      const history: ConversationMessage[] = msgsRef.current.map((m) => ({
        role: m.role,
        content: historyTextOf(m),
      }));

      updateMsgs((curr) => [
        ...curr,
        bubble(),
        { role: "assistant", parts: [], ts: nowIso(), pending: true, local: true },
      ]);
      updateStreaming(true);
      // This request can outlive the selected pane. Keep its paint work tied
      // to the view it started from; navigation must never paste old tokens or
      // a typing state into another agent's history.
      const streamViewEpoch = viewEpochRef.current;
      const ownsView = () => viewEpochRef.current === streamViewEpoch;

      // ── Project agent: streamed NDJSON, token-by-token like the super-agent.
      // It used to be a single blocking call, which meant no "typing", no
      // word-by-word — the pane sat blank until the whole reply arrived at once,
      // and a slow model read as "nothing happened", so turns got re-sent. ─────
      if (opts.agentSlug) {
        const slug = opts.agentSlug;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // Best guess until the turn's own `start` event names the conversation
        // — which it does before any work, so this only covers the microseconds
        // in between, and the first turn of a brand-new chat has nothing to name.
        turnTargetRef.current = convoRef.current ? { conversation_id: convoRef.current } : null;
        try {
          await Agents.chatStream(
            pid,
            slug,
            {
              prompt: trimmed,
              conversation_id: convoRef.current,
              model: opts.model || undefined,
              channel: "web",
              // Paths only, same as the super-agent turn below: the bytes are on
              // disk and the daemon re-resolves each one inside ~/.apx/media. An
              // engine with vision renders images; one without still gets a marker
              // in the prompt naming the file and its path.
              ...(opts.attachments?.length
                ? { attachments: opts.attachments.map((a) => ({ path: a.path, name: a.name })) }
                : {}),
            },
            (ev) => {
              if (!ownsView()) return;
              // Bind this pane (and any later regenerate/edit rewind) to the file
              // the daemon appended to — it only names it on the closing event.
              if (ev.type === "final" && ev.result?.conversation_id) {
                convoRef.current = ev.result.conversation_id;
                setConversationId(ev.result.conversation_id);
              }
              // The face: a project agent's turns are all its own, so stamp the
              // slug the reducer's final event doesn't know to set as the id.
              patchLast((m) => (m.agentId ? m : { ...m, agentId: slug }));
              applyEvent(ev);
            },
            ctrl.signal,
          );
          if (ownsView()) patchLast((m) => ({ ...m, pending: false }));
        } catch (e) {
          if (ctrl.signal.aborted && ownsView()) {
            patchLast((m) => ({
              ...m,
              pending: false,
              parts: [...m.parts, { kind: "text", text: t("code_module.stopped") }],
            }));
          } else if (ownsView()) {
            onError?.((e as Error)?.message || t("shared_ui.err_chat_failed"));
            updateMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
          }
        } finally {
          if (ownsView()) {
            updateStreaming(false);
            abortRef.current = null;
            turnTargetRef.current = null;
            queueMicrotask(() => drainQueueRef.current());
          }
        }
        return;
      }

      // ── Roby (super-agent): NDJSON event stream with tools. ────────────────
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // Roby's thread IS the channel — it has no conversation id — so that is
      // how the daemon addresses its live turn. See superAgentTurnKey.
      turnTargetRef.current = { channel: "web" };
      try {
        await SuperAgent.stream(
          pid,
          {
            prompt: trimmed,
            previousMessages: history,
            model: opts.model || undefined,
            channel: "web",
            // Paths only: the bytes are already on disk, and the daemon re-resolves
            // each one inside ~/.apx/media before it reads a single byte.
            ...(opts.attachments?.length
              ? { attachments: opts.attachments.map((a) => ({ path: a.path, name: a.name })) }
              : {}),
        },
          (ev) => { if (ownsView()) applyEvent(ev); },
          ctrl.signal,
        );
        if (ownsView()) patchLast((m) => ({ ...m, pending: false }));
      } catch (e) {
        if (ctrl.signal.aborted && ownsView()) {
          patchLast((m) => ({
            ...m,
            pending: false,
            parts: [...m.parts, { kind: "text", text: t("code_module.stopped") }],
          }));
        } else if (ownsView()) {
          onError?.((e as Error)?.message || t("shared_ui.err_stream_failed"));
          updateMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
        }
      } finally {
        if (ownsView()) {
          updateStreaming(false);
          abortRef.current = null;
          turnTargetRef.current = null;
          queueMicrotask(() => drainQueueRef.current());
        }
      }
    },
    [pid, applyEvent, patchLast, onError, stopTurn, bindQueue, updateMsgs, updateStreaming],
  );

  // Rewind the pane (and the bound file) to `keepVisible` turns, then send. The
  // file rewind matters for a project agent: the daemon rebuilds its history
  // from the conversation file, so without it the dropped turns would still be
  // there and the "regenerated" answer would see them. send() appends its bubble
  // to whatever msgs is after this slice, and — for a project agent — reads
  // history from the file, not its (stale) msgs closure, so the order is right.
  const rewindAndSend = useCallback(
    async (keepVisible: number, text: string, opts: SendOptions) => {
      if (streaming) return;
      if (convoRef.current && opts.agentSlug) {
        try {
          await Conversations.truncate(pid, opts.agentSlug, convoRef.current, keepVisible);
        } catch (e) {
          onError?.((e as Error)?.message || t("shared_ui.err_chat_failed"));
          return;
        }
      }
      updateMsgs((curr) => curr.slice(0, keepVisible));
      await send(text, opts);
    },
    [pid, streaming, send, onError, updateMsgs],
  );

  const regenerate = useCallback(
    async (index: number, opts: SendOptions = {}) => {
      const target = msgs[index];
      if (!target || target.role !== "assistant") return;
      // The user turn that produced it: the nearest user message before it.
      let u = index - 1;
      while (u >= 0 && msgs[u].role !== "user") u--;
      if (u < 0) return;
      // Keep the turns before that user turn; re-send its text (+ any files) so
      // it (and a fresh answer) are appended again. Strip markers when files
      // ride along — send() / the daemon add them back.
      const userMsg = msgs[u];
      const files = attachmentsOf(userMsg);
      const raw = historyTextOf(userMsg);
      const text = files.length ? stripLeadingMarkers(raw, files.length) : raw;
      await rewindAndSend(u, text, {
        ...opts,
        ...(files.length ? { attachments: files } : {}),
      });
    },
    [msgs, rewindAndSend],
  );

  const editAndResend = useCallback(
    async (index: number, text: string, opts: SendOptions = {}) => {
      const target = msgs[index];
      if (!target || target.role !== "user") return;
      // Keep the photo/file that was on the edited turn — only the caption
      // changes. Dropping media here is what made "edit text with photo" wipe
      // the image until a hard reload couldn't bring it back either.
      const files = attachmentsOf(target);
      await rewindAndSend(index, text, {
        ...opts,
        ...(files.length ? { attachments: files } : {}),
      });
    },
    [msgs, rewindAndSend],
  );

  // Stop ends the turn being written; it does not cancel what you queued. That
  // pairing is the point of the two buttons — "this answer is going the wrong
  // way, here is what I actually meant": send the correction, stop the run, and
  // the correction leaves immediately instead of after the wrong answer.
  const stop = useCallback(() => { void stopTurn(); }, [stopTurn]);
  const unqueue = useCallback((id: string) => {
    const key = queueKeyRef.current;
    if (!key) return;
    writeBackgroundQueue(key, readBackgroundQueue(key).filter((q) => q.id !== id));
  }, []);

  // Drain: one at a time, as soon as the pane is free.
  // msgsRef is synchronous, so the worker can drain after its pane unmounts and
  // still include the answer that just finished in the next turn's history.
  const sendRef = useRef(send);
  sendRef.current = send;
  const drainQueue = useCallback(() => {
    if (streamingRef.current || followingRef.current) return;
    const key = queueKeyRef.current;
    if (!key) return;
    const next = takeBackgroundQueue(key);
    if (next) void sendRef.current(next.text, next.opts);
  }, []);
  drainQueueRef.current = drainQueue;
  useEffect(() => {
    if (!streaming && !following && queued.length) drainQueue();
  }, [streaming, following, queued.length, drainQueue]);

  const clear = useCallback((queueKey?: string) => {
    loadSeqRef.current++; // cancel any in-flight history load
    beginViewChange();
    convoRef.current = undefined;
    threadRef.current = null;
    setConversationId(undefined);
    setConversationMeta(undefined);
    updateFollowing(false);
    turnTargetRef.current = null;
    if (queueKey) bindQueue(queueKey);
    else setQueued([]);
    updateMsgs([]);
  }, [beginViewChange, bindQueue, updateFollowing, updateMsgs]);

  const load = useCallback(
    async (agentSlug: string, conversationId: string, opts?: ReloadOptions) => {
      const seq = ++loadSeqRef.current;
      const activityKey = conversationActivityKey(pid, conversationId);
      if (!opts?.silent) {
        beginViewChange();
        bindQueue(activityKey);
      }
      // Blank the pane up front so it never shows the previous chat under the
      // new header while the fetch is in flight. A silent re-read is the SAME
      // chat catching up, so blanking would be a flash of empty for nothing —
      // and for the same reason it keeps the queue: what you queued belongs to
      // this thread, and only actually LEAVING it drops it.
      if (!opts?.silent) updateMsgs([]);
      try {
        const detail = await Conversations.get(pid, agentSlug, conversationId);
        if (seq !== loadSeqRef.current) return; // superseded by a newer pick
        const loaded = threadToChatMsgs(detail.messages ?? []);
        convoRef.current = conversationId;
        threadRef.current = null;
        setConversationId(conversationId);
        setConversationMeta(metaFromDetail(detail));
        // Opening a chat whose answer is still being written: show the partial
        // as a streaming bubble and let the live "turn" frames carry on filling
        // it — the whole point of the push feed. Only on a real open; a silent
        // refetch leaves the live bubble the frames are already maintaining.
        const active = !opts?.silent && !isChatTurnClosed(detail.active_turn?.turn_id)
          ? detail.active_turn
          : null;
        if (active) {
          liveTurnRef.current = { id: active.turn_id, text: active.text || "" };
          updateFollowing(true);
          turnTargetRef.current = { conversation_id: conversationId };
        } else if (!opts?.silent) {
          liveTurnRef.current = null;
          updateFollowing(false);
          turnTargetRef.current = null;
        }
        updateMsgs((curr) =>
          opts?.silent ? mergeLocalTurns(loaded, curr) : withActiveTurn(loaded, active),
        );
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        // A background refresh that failed is a refresh that did not happen:
        // keep showing the conversation and stay quiet. Only a refresh the user
        // asked for by picking a chat reports, and clears.
        if (opts?.silent) return;
        convoRef.current = undefined;
        threadRef.current = null;
        setConversationId(undefined);
        setConversationMeta(undefined);
        updateFollowing(false);
        updateMsgs([]);
        onError?.((e as Error)?.message || t("shared_ui.err_load_conversation"));
      }
    },
    [pid, onError, beginViewChange, bindQueue, updateFollowing, updateMsgs],
  );

  const loadThread = useCallback(
    async (channel: string, threadId: string, opts?: ReloadOptions) => {
      const seq = ++loadSeqRef.current;
      if (!opts?.silent) {
        beginViewChange();
        bindQueue(threadActivityKey(pid, channel, threadId));
        updateMsgs([]);
      }
      try {
        const detail = await Conversations.thread(pid, channel, threadId);
        if (seq !== loadSeqRef.current) return; // superseded by a newer pick
        const loaded = threadToChatMsgs(detail.messages ?? []);
        // Ledger threads have no conversation file — sends continue as fresh
        // web turns with this history as previousMessages.
        convoRef.current = undefined;
        threadRef.current = { channel, id: threadId };
        setConversationId(undefined);
        // A thread knows its own name and channel, same as a conversation file
        // does — the header should not have to be handed them by whichever list
        // happened to open it.
        setConversationMeta({
          channel: detail.channel,
          title: detail.title,
          participants: detail.participants,
          faces: detail.participant_faces,
        });
        const active = !opts?.silent && !isChatTurnClosed(detail.active_turn?.turn_id)
          ? detail.active_turn
          : null;
        if (active) {
          liveTurnRef.current = { id: active.turn_id, text: active.text || "" };
          updateFollowing(true);
          turnTargetRef.current = { channel };
        } else if (!opts?.silent) {
          liveTurnRef.current = null;
          updateFollowing(false);
          turnTargetRef.current = null;
        }
        updateMsgs((curr) => (
          opts?.silent
            ? mergeLocalTurns(loaded, curr)
            : withActiveTurn(loaded, active)
        ));
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        if (opts?.silent) return; // see load(): a failed catch-up changes nothing
        convoRef.current = undefined;
        threadRef.current = null;
        setConversationId(undefined);
        updateFollowing(false);
        updateMsgs([]);
        onError?.((e as Error)?.message || t("shared_ui.err_load_conversation"));
      }
    },
    [pid, onError, beginViewChange, bindQueue, updateFollowing, updateMsgs],
  );

  // A group turn streams like a 1:1 one — same pending-bubble machinery — but the
  // reply comes as a CASCADE of speakers on the group endpoint. Each speaker gets
  // its own streaming assistant bubble (name + "traído por X"), tokens land as
  // they are written, and the "… está escribiendo" pill rides on the pending
  // bubble exactly where a normal turn's does. `rerun` resumes from one speaker
  // against the last owner message (regenerate) instead of appending a new one.
  const sendGroup = useCallback(
    async (gid: string, text: string, nameOf: (slug: string) => string, opts: { rerun?: boolean; from?: string; reason?: string | null; media?: UploadedMedia[] } = {}) => {
      const trimmed = text.trim();
      const files = opts.media || [];
      if (streaming) return;
      if (!opts.rerun && !trimmed && !files.length) return;
      const nowIso = () => new Date().toISOString();
      if (!opts.rerun) {
        // Optimistic owner bubble — shows the photo/file immediately, same as a
        // 1:1 turn; the marker rides on the text the way the daemon folds it.
        updateMsgs((curr) => [...curr, {
          role: "user",
          parts: userPart([markersFor(files), trimmed].filter(Boolean).join(" ")),
          ts: nowIso(), local: true,
          ...(files.length ? { media: files.map(mediaOf) } : {}),
        }]);
      }
      updateStreaming(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // How the DAEMON addresses this cascade, set before the first byte: a room
      // is a thread on channel "group", and a project runs several at once, so
      // the id has to ride along. Without it Stop only closed this socket while
      // the room kept working — the one turn shape that can run ten tool loops
      // off a single line was the one that could not be interrupted.
      turnTargetRef.current = { channel: "group", thread_id: gid };
      const onEvent = (ev: import("../lib/api/groups").GroupStreamEvent) => {
        if (ev.type === "speaker_start") {
          updateMsgs((curr) => [...curr, {
            role: "assistant", parts: [], ts: nowIso(), pending: true, local: true,
            agentId: ev.slug, agent: nameOf(ev.slug),
            ...(ev.reason ? { reason: ev.reason } : {}),
          }]);
        } else if (ev.type === "speaker_delta") {
          // Reuse the exact token-merge the 1:1 stream uses.
          applyEvent({ type: "assistant_delta", delta: ev.delta } as ChatStreamEvent);
        } else if (
          ev.type === "tool_start" ||
          ev.type === "tool_result" ||
          ev.type === "tool_deduped" ||
          ev.type === "assistant_text" ||
          ev.type === "model_start" ||
          ev.type === "model_routed" ||
          ev.type === "engine_failed" ||
          ev.type === "model_retry" ||
          ev.type === "tools_suppressed" ||
          ev.type === "skill_inspector" ||
          ev.type === "reasoning"
        ) {
          applyEvent(ev as ChatStreamEvent);
        } else if (ev.type === "speaker_final") {
          patchLast((m) => ({ ...m, pending: false, ...(ev.model ? { model: ev.model } : {}), ...(ev.usage ? { usage: ev.usage } : {}) }));
        } else if (ev.type === "speaker_aborted") {
          // You stopped the room mid-reply. Whatever this speaker had written is
          // real work you watched happen and the daemon kept it in the thread —
          // mark it the way a stopped 1:1 turn is marked, not as a failure.
          patchLast((m) => ({ ...m, pending: false, parts: [...m.parts, { kind: "text", text: t("code_module.stopped") }] }));
        }
      };
      try {
        if (opts.rerun) await Groups.rerunStream(pid, gid, onEvent, ctrl.signal,
          opts.from ? { from: opts.from, reason: opts.reason } : undefined);
        else await Groups.sendStream(pid, gid, trimmed, onEvent, ctrl.signal,
          files.map((a) => ({ path: a.path, name: a.name })));
        patchLast((m) => ({ ...m, pending: false }));
      } catch (e) {
        if (ctrl.signal.aborted) patchLast((m) => ({ ...m, pending: false }));
        else onError?.((e as Error)?.message || t("shared_ui.err_chat_failed"));
      } finally {
        updateStreaming(false);
        abortRef.current = null;
        turnTargetRef.current = null;
        // Reconcile with the canonical thread (model/usage/reason from the ledger,
        // join/leave notices, and drops the local bubbles for the persisted ones).
        void loadThread("group", gid, { silent: true });
      }
    },
    [pid, streaming, applyEvent, patchLast, loadThread, onError, updateMsgs, updateStreaming],
  );

  return {
    msgs,
    send,
    sendGroup,
    regenerate,
    editAndResend,
    stop,
    clear,
    load,
    loadThread,
    streaming: streaming || following,
    queued,
    unqueue,
    conversationId,
    conversationMeta,
  };
}
