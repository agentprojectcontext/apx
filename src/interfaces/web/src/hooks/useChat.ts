import { useCallback, useRef, useState } from "react";
import { SuperAgent, Agents, Conversations } from "../lib/api";
import type { ChatStreamEvent, ChatUsage, ConversationMessage } from "../types/daemon";
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
}

export type ChatPart = TextPart | ToolPart;

export interface ChatMsg {
  role: "user" | "assistant";
  /** Ordered parts of the turn: interleaved assistant text and tool calls. */
  parts: ChatPart[];
  ts: string;
  pending?: boolean;
  /** Model that produced an assistant turn (after routing). */
  model?: string;
  /** Token accounting from the `final` event. */
  usage?: ChatUsage;
  /** Operational notes (engine fallbacks, retries, suppressions). */
  notes?: string[];
  /** Skill Inspector decision for this turn (when the feature is on): which
   *  skills the per-turn RAG loaded inline vs merely hinted. */
  inspector?: {
    embedder?: string;
    loaded?: string[];
    hinted?: string[];
  };
}

export interface SendOptions {
  /** Empty / undefined → Auto (router decides). Forwarded as body.model. */
  model?: string;
  /** When set, talk to a project agent (non-streaming) instead of Roby. */
  agentSlug?: string;
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

function isErrorResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  return "error" in r && !!r.error;
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
        },
      };
    }
    case "assistant_text":
      return ev.text ? { ...turn, parts: [...turn.parts, { kind: "text", text: ev.text }] } : turn;
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
    case "final":
      return {
        ...turn,
        pending: false,
        usage: ev.result?.usage ?? turn.usage,
        model: turn.model ?? ev.result?.name,
        parts:
          ev.result?.text && !turn.parts.some((p) => p.kind === "text")
            ? [...turn.parts, { kind: "text", text: ev.result.text }]
            : turn.parts,
      };
    default: {
      // Raw-delta engines (no assistant_text) — append to the trailing text.
      const piece = ev.delta || ev.content || "";
      if (!piece) return turn;
      const parts = [...turn.parts];
      const last = parts[parts.length - 1];
      if (last && last.kind === "text") parts[parts.length - 1] = { ...last, text: last.text + piece };
      else parts.push({ kind: "text", text: piece });
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
      if (!trimmed || streaming) return;
      const nowIso = () => new Date().toISOString();
      const history: ConversationMessage[] = msgs.map((m) => ({
        role: m.role,
        content: historyTextOf(m),
      }));

      setMsgs((curr) => [
        ...curr,
        { role: "user", parts: userPart(trimmed), ts: nowIso() },
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
          { prompt: trimmed, previousMessages: history, model: opts.model || undefined, channel: "web" },
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
    convoRef.current = undefined;
    setConversationId(undefined);
    setMsgs([]);
  }, [streaming]);

  const load = useCallback(
    async (agentSlug: string, conversationId: string) => {
      if (streaming) return;
      try {
        const detail = await Conversations.get(pid, agentSlug, conversationId);
        const loaded: ChatMsg[] = (detail.messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            parts: [{ kind: "text", text: m.content }],
            ts: m.ts || new Date().toISOString(),
          }));
        convoRef.current = conversationId;
        setConversationId(conversationId);
        setMsgs(loaded);
      } catch (e) {
        onError?.((e as Error)?.message || t("shared_ui.err_load_conversation"));
      }
    },
    [pid, streaming, onError],
  );

  return { msgs, send, stop, clear, load, streaming, conversationId };
}
