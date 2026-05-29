import { useCallback, useRef, useState } from "react";
import { SuperAgent } from "../lib/api";
import type { ChatStreamEvent, ConversationMessage } from "../types/daemon";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  ts: string;
  pending?: boolean;
}

export interface UseChatResult {
  msgs: ChatMsg[];
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  streaming: boolean;
}

/**
 * Wraps `SuperAgent.stream` with local message state. Re-entrant: while one
 * stream is in flight, further send() calls are ignored.
 */
export function useChat(pid: string, onError?: (msg: string) => void): UseChatResult {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    const nowIso = () => new Date().toISOString();
    const history: ConversationMessage[] = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((curr) => [
      ...curr,
      { role: "user", content: trimmed, ts: nowIso() },
      { role: "assistant", content: "", ts: nowIso(), pending: true },
    ]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    let buf = "";

    try {
      await SuperAgent.stream(
        pid,
        { prompt: trimmed, previousMessages: history },
        (ev: ChatStreamEvent) => {
          if (ev?.type === "error") {
            onError?.(ev?.error || "stream error");
            return;
          }
          const piece = ev?.delta || ev?.text || ev?.content || "";
          if (typeof piece === "string" && piece) {
            buf += piece;
            setMsgs((curr) => {
              const copy = [...curr];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: buf };
              }
              return copy;
            });
          }
        },
        ctrl.signal,
      );
      setMsgs((curr) => {
        const copy = [...curr];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: buf || last.content, pending: false };
        }
        return copy;
      });
    } catch (e) {
      const aborted = ctrl.signal.aborted;
      if (aborted) {
        setMsgs((curr) => {
          const copy = [...curr];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = {
              ...last,
              content: (last.content || "") + " [detenido]",
              pending: false,
            };
          }
          return copy;
        });
      } else {
        onError?.((e as Error)?.message || "stream falló");
        setMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [pid, msgs, streaming, onError]);

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);
  const clear = useCallback(() => { if (!streaming) setMsgs([]); }, [streaming]);

  return { msgs, send, stop, clear, streaming };
}
