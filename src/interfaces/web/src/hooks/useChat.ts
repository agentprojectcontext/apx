import { useCallback, useEffect, useRef, useState } from "react";
import { SuperAgent, Agents, Conversations, Groups } from "../lib/api";
import type { ActiveTurn, AgentFace, ChatStreamEvent, ChatUsage, ConversationMessage, MessageMedia, ToolSummary, TurnFrame } from "../types/daemon";
import type { UploadedMedia } from "../lib/api/media";
import { subscribeTurns } from "../lib/live";
import { t } from "../i18n";

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
  clear: () => void;
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
  return [
    ...loaded,
    {
      role: "assistant",
      parts: active.text ? [{ kind: "text", text: active.text, streaming: true }] : [],
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
  const [streaming, setStreaming] = useState(false);
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
  const queueSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const convoRef = useRef<string | undefined>(undefined);
  // Monotonic token guarding async history loads. Every load()/loadThread()/
  // clear() bumps it; a load only applies its result if it's still the latest.
  // Without this, clicking chat A then B could land A's (slower) response last
  // and paint A's messages under B's header.
  const loadSeqRef = useRef(0);
  // True while THIS tab is the one streaming a turn over its own NDJSON socket.
  // The sender renders from that; it must ignore the live-turn frames the daemon
  // also pushes for everyone else, or it would paint each token twice.
  const streamingRef = useRef(false);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  // The turn this tab is FOLLOWING from the live feed (a turn it did not start):
  // its id and the text accumulated so far, so a frame that arrives after a
  // background refetch wiped the bubble can repaint it whole rather than lose it.
  const liveTurnRef = useRef<{ id: string; text: string } | null>(null);

  // Mutate the trailing assistant turn in place.
  const patchLast = useCallback((fn: (m: ChatMsg) => ChatMsg) => {
    setMsgs((curr) => {
      const copy = [...curr];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant") copy[copy.length - 1] = fn(last);
      return copy;
    });
  }, []);

  const applyEvent = useCallback(
    (ev: ChatStreamEvent) => {
      if (ev.type === "error") {
        onError?.(ev.error || t("shared_ui.err_stream"));
        return;
      }
      patchLast((m) => applyStreamEvent(m, ev));
    },
    [patchLast, onError],
  );

  // ── Following a turn this tab did NOT start (live push) ──────────────────
  // paintLive upserts a trailing STREAMING assistant bubble (local, so a
  // background refetch keeps it) from the full accumulated text; finalizeLive
  // turns it into a settled reply (no longer local, so the next silent reload
  // replaces it with the identical persisted turn instead of doubling it).
  const paintLive = useCallback((text: string, agentSlug?: string) => {
    setMsgs((curr) => {
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
  }, []);

  const finalizeLive = useCallback(
    (text: string, opts: { model?: string; name?: string; usage?: ChatUsage; error?: string }) => {
      setMsgs((curr) => {
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
    [],
  );

  // The daemon pushes every in-progress turn's tokens over the shared feed. A
  // tab that is NOT the sender — a second window, or this one after a refresh /
  // switching chats and back — follows them here, so streaming survives losing
  // the connection that started it.
  const onTurnFrame = useCallback((f: TurnFrame) => {
    if (streamingRef.current) return;                 // the sender renders via NDJSON
    if (String(f.project_id) !== String(pid)) return;
    if (!convoRef.current || f.conversation_id !== convoRef.current) return;
    if (f.phase === "start") {
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
      finalizeLive(f.result?.text ?? "", {
        model: f.result?.model,
        name: f.result?.name || f.agent_slug || undefined,
        usage: f.result?.usage,
      });
    } else if (f.phase === "error") {
      liveTurnRef.current = null;
      finalizeLive("", { error: f.error });
    }
  }, [pid, paintLive, finalizeLive]);

  useEffect(() => subscribeTurns(onTurnFrame), [onTurnFrame]);

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
      if (streaming) {
        setQueued((curr) => [...curr, { id: `q${++queueSeq.current}`, text: trimmed, opts, msg: bubble() }]);
        return;
      }

      const history: ConversationMessage[] = msgs.map((m) => ({
        role: m.role,
        content: historyTextOf(m),
      }));

      setMsgs((curr) => [
        ...curr,
        bubble(),
        { role: "assistant", parts: [], ts: nowIso(), pending: true, local: true },
      ]);
      setStreaming(true);

      // ── Project agent: streamed NDJSON, token-by-token like the super-agent.
      // It used to be a single blocking call, which meant no "typing", no
      // word-by-word — the pane sat blank until the whole reply arrived at once,
      // and a slow model read as "nothing happened", so turns got re-sent. ─────
      if (opts.agentSlug) {
        const slug = opts.agentSlug;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
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
          patchLast((m) => ({ ...m, pending: false }));
        } catch (e) {
          if (ctrl.signal.aborted) {
            patchLast((m) => ({
              ...m,
              pending: false,
              parts: [...m.parts, { kind: "text", text: t("code_module.stopped") }],
            }));
          } else {
            onError?.((e as Error)?.message || t("shared_ui.err_chat_failed"));
            setMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
          }
        } finally {
          setStreaming(false);
          abortRef.current = null;
        }
        return;
      }

      // ── Roby (super-agent): NDJSON event stream with tools. ────────────────
      const ctrl = new AbortController();
      abortRef.current = ctrl;
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
          applyEvent,
          ctrl.signal,
        );
        patchLast((m) => ({ ...m, pending: false }));
      } catch (e) {
        if (ctrl.signal.aborted) {
          patchLast((m) => ({
            ...m,
            pending: false,
            parts: [...m.parts, { kind: "text", text: t("code_module.stopped") }],
          }));
        } else {
          onError?.((e as Error)?.message || t("shared_ui.err_stream_failed"));
          setMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [pid, msgs, streaming, applyEvent, patchLast, onError],
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
      setMsgs((curr) => curr.slice(0, keepVisible));
      await send(text, opts);
    },
    [pid, streaming, send, onError],
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
  const stop = useCallback(() => abortRef.current?.abort(), []);
  const unqueue = useCallback((id: string) => setQueued((curr) => curr.filter((q) => q.id !== id)), []);

  // Drain: one at a time, as soon as the pane is free.
  //
  // From an EFFECT, not from `send`'s own `finally`. `send` builds its history
  // out of the `msgs` its closure captured — the list as it was before the turn
  // that just finished was written into it — so a queued message sent from in
  // there would reach an agent with no record of the answer it is replying to.
  // An effect runs after the render that committed those messages and reads
  // them back through a fresh `send`.
  useEffect(() => {
    if (streaming || queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void send(next.text, next.opts);
  }, [streaming, queued, send]);

  const clear = useCallback(() => {
    if (streaming) return;
    loadSeqRef.current++; // cancel any in-flight history load
    convoRef.current = undefined;
    setConversationId(undefined);
    setConversationMeta(undefined);
    setQueued([]);
    setMsgs([]);
  }, [streaming]);

  const load = useCallback(
    async (agentSlug: string, conversationId: string, opts?: ReloadOptions) => {
      if (streaming) return;
      const seq = ++loadSeqRef.current;
      // Blank the pane up front so it never shows the previous chat under the
      // new header while the fetch is in flight. A silent re-read is the SAME
      // chat catching up, so blanking would be a flash of empty for nothing —
      // and for the same reason it keeps the queue: what you queued belongs to
      // this thread, and only actually LEAVING it drops it.
      if (!opts?.silent) { setMsgs([]); setQueued([]); }
      try {
        const detail = await Conversations.get(pid, agentSlug, conversationId);
        if (seq !== loadSeqRef.current) return; // superseded by a newer pick
        const loaded = threadToChatMsgs(detail.messages ?? []);
        convoRef.current = conversationId;
        setConversationId(conversationId);
        setConversationMeta(metaFromDetail(detail));
        // Opening a chat whose answer is still being written: show the partial
        // as a streaming bubble and let the live "turn" frames carry on filling
        // it — the whole point of the push feed. Only on a real open; a silent
        // refetch leaves the live bubble the frames are already maintaining.
        const active = !opts?.silent ? detail.active_turn : null;
        if (active) liveTurnRef.current = { id: active.turn_id, text: active.text || "" };
        else if (!opts?.silent) liveTurnRef.current = null;
        setMsgs((curr) =>
          opts?.silent ? mergeLocalTurns(loaded, curr) : withActiveTurn(loaded, active),
        );
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        // A background refresh that failed is a refresh that did not happen:
        // keep showing the conversation and stay quiet. Only a refresh the user
        // asked for by picking a chat reports, and clears.
        if (opts?.silent) return;
        convoRef.current = undefined;
        setConversationId(undefined);
        setConversationMeta(undefined);
        setMsgs([]);
        onError?.((e as Error)?.message || t("shared_ui.err_load_conversation"));
      }
    },
    [pid, streaming, onError],
  );

  const loadThread = useCallback(
    async (channel: string, threadId: string, opts?: ReloadOptions) => {
      if (streaming) return;
      const seq = ++loadSeqRef.current;
      if (!opts?.silent) { setMsgs([]); setQueued([]); } // see load()
      try {
        const detail = await Conversations.thread(pid, channel, threadId);
        if (seq !== loadSeqRef.current) return; // superseded by a newer pick
        const loaded = threadToChatMsgs(detail.messages ?? []);
        // Ledger threads have no conversation file — sends continue as fresh
        // web turns with this history as previousMessages.
        convoRef.current = undefined;
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
        setMsgs((curr) => (opts?.silent ? mergeLocalTurns(loaded, curr) : loaded));
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        if (opts?.silent) return; // see load(): a failed catch-up changes nothing
        convoRef.current = undefined;
        setConversationId(undefined);
        setMsgs([]);
        onError?.((e as Error)?.message || t("shared_ui.err_load_conversation"));
      }
    },
    [pid, streaming, onError],
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
        setMsgs((curr) => [...curr, {
          role: "user",
          parts: userPart([markersFor(files), trimmed].filter(Boolean).join(" ")),
          ts: nowIso(), local: true,
          ...(files.length ? { media: files.map(mediaOf) } : {}),
        }]);
      }
      setStreaming(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const onEvent = (ev: import("../lib/api/groups").GroupStreamEvent) => {
        if (ev.type === "speaker_start") {
          setMsgs((curr) => [...curr, {
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
        setStreaming(false);
        abortRef.current = null;
        // Reconcile with the canonical thread (model/usage/reason from the ledger,
        // join/leave notices, and drops the local bubbles for the persisted ones).
        void loadThread("group", gid, { silent: true });
      }
    },
    [pid, streaming, applyEvent, patchLast, loadThread, onError],
  );

  return { msgs, send, sendGroup, regenerate, editAndResend, stop, clear, load, loadThread, streaming, queued, unqueue, conversationId, conversationMeta };
}
