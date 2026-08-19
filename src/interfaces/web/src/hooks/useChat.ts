import { useCallback, useRef, useState } from "react";
import { SuperAgent, Agents, Conversations } from "../lib/api";
import type { ChatStreamEvent, ChatUsage, ConversationMessage, MessageMedia, ToolSummary } from "../types/daemon";
import type { UploadedMedia } from "../lib/api/media";
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
  media?: MessageMedia;
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

export interface UseChatResult {
  msgs: ChatMsg[];
  send: (text: string, opts?: SendOptions) => Promise<void>;
  stop: () => void;
  clear: () => void;
  /** Load a persisted conversation as history and bind subsequent sends to it.
   *  Only supported for project agents (super-agent conversations aren't
   *  persisted per-file). Pass `null` to drop the binding without clearing. */
  load: (agentSlug: string, conversationId: string) => Promise<void>;
  /** Load a super-agent channel thread (telegram/desktop/…) as history. Not
   *  bound to a conversation file — continuing sends go out as fresh web
   *  turns with the thread as previousMessages context. */
  loadThread: (channel: string, threadId: string) => Promise<void>;
  streaming: boolean;
  /** Conversation id we're bound to, if any. Lets callers reflect "live vs
   *  loaded" state in the UI. */
  conversationId: string | undefined;
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

/** The marker the daemon will write for this file, mirrored locally so the sent
 *  turn reads the same before and after a reload. */
const markerFor = (file: UploadedMedia | undefined): string => {
  if (!file) return "";
  return file.kind === "photo" ? "[image attached]" : `[file attached: ${file.name}]`;
};

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
      out.push({ role: "user", parts: userPart(m.content), ts, ...(m.media ? { media: m.media } : {}) });
    } else if (m.role === "assistant" || m.role === "tool") {
      // Tool rows inherit the current actor (they're logged by whoever is
      // running); only assistant rows can start a new one.
      const actor = m.role === "assistant" ? m.agent : turnActor;
      if (!turn || (m.role === "assistant" && actor !== turnActor)) {
        turn = { role: "assistant", parts: [], ts };
        turnActor = actor;
        out.push(turn);
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
        if (m.model) turn.model = m.model;
        if (m.tool_summary) turn.toolSummary = m.tool_summary;
        if (m.skill_inspector) turn.inspector = m.skill_inspector;
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
    }
    // system/compact rows are context-only; not rendered in the thread viewer.
  }
  return out;
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
      if (!insp || (!insp.loaded?.length && !insp.hinted?.length)) return turn;
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
  const abortRef = useRef<AbortController | null>(null);
  const convoRef = useRef<string | undefined>(undefined);
  // Monotonic token guarding async history loads. Every load()/loadThread()/
  // clear() bumps it; a load only applies its result if it's still the latest.
  // Without this, clicking chat A then B could land A's (slower) response last
  // and paint A's messages under B's header.
  const loadSeqRef = useRef(0);

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

  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      const trimmed = text.trim();
      const file = opts.attachments?.[0];
      // A photo with no caption is a turn; text alone still is one.
      if ((!trimmed && !file) || streaming) return;
      const nowIso = () => new Date().toISOString();
      const history: ConversationMessage[] = msgs.map((m) => ({
        role: m.role,
        content: historyTextOf(m),
      }));

      setMsgs((curr) => [
        ...curr,
        {
          role: "user",
          // The marker rides on the turn's text the way it does on every other
          // channel: the bubble strips it (the file is shown instead) and the
          // NEXT turn's history still records that something was attached.
          parts: userPart([markerFor(file), trimmed].filter(Boolean).join(" ")),
          ts: nowIso(),
          ...(file ? { media: mediaOf(file) } : {}),
        },
        { role: "assistant", parts: [], ts: nowIso(), pending: true },
      ]);
      setStreaming(true);

      // ── Project agent: blocking call, single text part, no tools. ──────────
      if (opts.agentSlug) {
        try {
          const out = await Agents.chat(pid, opts.agentSlug, {
            prompt: trimmed,
            conversation_id: convoRef.current,
            model: opts.model || undefined,
            channel: "web",
          });
          convoRef.current = out.conversation_id;
          setConversationId(out.conversation_id);
          patchLast((m) => ({
            ...m,
            pending: false,
            model: out.engine,
            agent: opts.agentSlug,
            agentId: opts.agentSlug,
            usage: out.usage,
            parts: [{ kind: "text", text: out.text }],
          }));
        } catch (e) {
          onError?.((e as Error)?.message || t("shared_ui.err_chat_failed"));
          setMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
        } finally {
          setStreaming(false);
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

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => {
    if (streaming) return;
    loadSeqRef.current++; // cancel any in-flight history load
    convoRef.current = undefined;
    setConversationId(undefined);
    setMsgs([]);
  }, [streaming]);

  const load = useCallback(
    async (agentSlug: string, conversationId: string) => {
      if (streaming) return;
      const seq = ++loadSeqRef.current;
      // Blank the pane up front so it never shows the previous chat under the
      // new header while the fetch is in flight.
      setMsgs([]);
      try {
        const detail = await Conversations.get(pid, agentSlug, conversationId);
        if (seq !== loadSeqRef.current) return; // superseded by a newer pick
        const loaded = threadToChatMsgs(detail.messages ?? []);
        convoRef.current = conversationId;
        setConversationId(conversationId);
        setMsgs(loaded);
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        convoRef.current = undefined;
        setConversationId(undefined);
        setMsgs([]);
        onError?.((e as Error)?.message || t("shared_ui.err_load_conversation"));
      }
    },
    [pid, streaming, onError],
  );

  const loadThread = useCallback(
    async (channel: string, threadId: string) => {
      if (streaming) return;
      const seq = ++loadSeqRef.current;
      setMsgs([]);
      try {
        const detail = await Conversations.thread(pid, channel, threadId);
        if (seq !== loadSeqRef.current) return; // superseded by a newer pick
        const loaded = threadToChatMsgs(detail.messages ?? []);
        // Ledger threads have no conversation file — sends continue as fresh
        // web turns with this history as previousMessages.
        convoRef.current = undefined;
        setConversationId(undefined);
        setMsgs(loaded);
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        convoRef.current = undefined;
        setConversationId(undefined);
        setMsgs([]);
        onError?.((e as Error)?.message || t("shared_ui.err_load_conversation"));
      }
    },
    [pid, streaming, onError],
  );

  return { msgs, send, stop, clear, load, loadThread, streaming, conversationId };
}
