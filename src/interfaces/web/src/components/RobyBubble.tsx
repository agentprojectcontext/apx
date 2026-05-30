// "Chat con Roby" sheet — the super-agent (APX-level agent, persona from
// identity.json) reachable from anywhere. The launcher now lives in the left
// rail (below Settings); this component only owns the Sheet + conversation.
// Open state is lifted to the App shell and passed in via props.
//
// Wraps the streaming super-agent endpoint
// (POST /projects/0/super-agent/chat/stream, project id 0 = base). The
// conversation is persisted to localStorage so it survives refresh and route
// changes — the *same* thread until "Nuevo chat". Tool activity is rendered
// inline (collapsible args + results) so you can see exactly what Roby does.

import { useEffect, useRef, useState } from "react";
import { Bot, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { ChatInput } from "./ui/chat-input";
import { ModelPicker } from "./chat/ModelPicker";
import { MessageList } from "./chat/MessageList";
import { ContextBar } from "./chat/ContextBar";
import { applyStreamEvent, textOf, type ChatMsg } from "../hooks/useChat";
import { SuperAgent } from "../lib/api";
import { STORAGE } from "../constants";
import { useToast } from "./Toast";
import { t } from "../i18n";
import type { ChatStreamEvent, ConversationMessage } from "../types/daemon";

// Load any persisted conversation, dropping half-finished (pending) turns.
function loadStored(): ChatMsg[] {
  try {
    const raw = localStorage.getItem(STORAGE.robyChat);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMsg[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && Array.isArray(m.parts) && !m.pending);
  } catch {
    return [];
  }
}

export function RobyBubble({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<ChatMsg[]>(loadStored);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Persist the settled conversation (skip pending turns).
  useEffect(() => {
    const settled = msgs.filter((m) => !m.pending);
    try {
      if (settled.length) localStorage.setItem(STORAGE.robyChat, JSON.stringify(settled));
      else localStorage.removeItem(STORAGE.robyChat);
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [msgs]);

  const newChat = () => {
    if (busy) return;
    setMsgs([]);
    setDraft("");
    try {
      localStorage.removeItem(STORAGE.robyChat);
    } catch {
      /* ignore */
    }
  };

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const patchLast = (fn: (m: ChatMsg) => ChatMsg) =>
    setMsgs((curr) => {
      const copy = [...curr];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") copy[copy.length - 1] = fn(last);
      return copy;
    });

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const now = new Date().toISOString();
    const history: ConversationMessage[] = msgs
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role, content: textOf(m) }));
    setMsgs((curr) => [
      ...curr,
      { role: "user", parts: [{ kind: "text", text: prompt }], ts: now },
      { role: "assistant", parts: [], ts: now, pending: true },
    ]);
    setDraft("");
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let errored = false;

    const onEvent = (ev: ChatStreamEvent) => {
      if (ev?.type === "error") {
        errored = true;
        toast.error(ev.error || "error");
        setMsgs((curr) => {
          const copy = [...curr];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.pending) copy.pop();
          return copy;
        });
        return;
      }
      patchLast((m) => applyStreamEvent(m, ev));
    };

    try {
      await SuperAgent.stream(
        0,
        { prompt, previousMessages: history, model: model || undefined },
        onEvent,
        ctrl.signal,
      );
      patchLast((m) => ({ ...m, pending: false }));
    } catch (e) {
      if (ctrl.signal.aborted) {
        patchLast((m) => ({
          ...m,
          pending: false,
          parts: [...m.parts, { kind: "text", text: t("project.chat.stopped_marker") }],
        }));
      } else if (!errored) {
        toast.error((e as Error).message);
        setMsgs((curr) => {
          const copy = [...curr];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.pending) copy.pop();
          return copy;
        });
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.info(t("project.chat.copied"));
    } catch {
      /* ignore */
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Bot size={18} /> {t("roby.title")}
            <span className="text-xs font-normal text-muted-fg">{t("roby.badge")}</span>
          </SheetTitle>
          <SheetDescription>{t("roby.desc")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {msgs.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted-fg">{t("roby.empty")}</p>
          ) : (
            <MessageList msgs={msgs} onCopy={copyToClipboard} />
          )}
        </div>

        <ContextBar msgs={msgs} />

        <div className="border-t border-border p-3">
          <ChatInput
            value={draft}
            onValueChange={setDraft}
            onSubmit={() => void send()}
            onStop={stop}
            busy={busy}
            placeholder={t("roby.placeholder")}
            footer={<ModelPicker value={model} onChange={setModel} disabled={busy} />}
          />
          <div className="mt-1.5 flex justify-end">
            <Button
              size="xs"
              variant="ghost"
              onClick={newChat}
              disabled={busy || msgs.length === 0}
            >
              <Plus className="size-3" /> {t("roby.new_chat")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
