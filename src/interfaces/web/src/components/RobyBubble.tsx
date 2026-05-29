// Floating "chat con Roby" bubble — visible on every authenticated page so the
// user can reach the super-agent (the APX-level agent, persona name from
// identity.json) from anywhere without leaving the current screen.
//
// Wraps POST /projects/0/super-agent/chat (project id 0 = base). Conversation
// lives in component state — long-term history is browsable in /p/0/threads
// ("Chats") if/when the daemon persists it. We keep this lightweight on
// purpose: a focused side panel, not a full chat UI replacement.

import { useEffect, useRef, useState } from "react";
import { Bot, Send, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { SuperAgent } from "../lib/api";
import { useToast } from "./Toast";
import type { ConversationMessage } from "../types/daemon";

interface Msg {
  role: "user" | "assistant";
  content: string;
  ts: string;
  pending?: boolean;
}

export function RobyBubble() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message.
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const now = new Date().toISOString();
    const history: ConversationMessage[] = msgs
      .filter((m) => !m.pending && m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    setMsgs((curr) => [
      ...curr,
      { role: "user", content: prompt, ts: now },
      { role: "assistant", content: "", ts: now, pending: true },
    ]);
    setDraft("");
    setBusy(true);
    try {
      const out = await SuperAgent.send(0, { prompt, previousMessages: history });
      setMsgs((curr) => {
        const copy = [...curr];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: out.text, pending: false };
        }
        return copy;
      });
    } catch (e) {
      setMsgs((curr) => {
        const copy = [...curr];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.pending) copy.pop();
        return copy;
      });
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating launcher — always pinned to the bottom-right corner of the
          viewport, above the rest of the UI. Hidden when the sheet is open
          to avoid two affordances overlapping. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Hablar con Roby"
          className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background transition hover:scale-105 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
          aria-label="Hablar con Roby"
        >
          <Bot size={22} />
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot size={18} /> Roby
              <span className="text-xs font-normal text-muted-fg">super-agent · APX</span>
            </SheetTitle>
            <SheetDescription>
              Conversación rápida con tu super-agente. Tiene acceso a tools (proyectos,
              tasks, mcps, agentes); para un hilo más largo y persistente, abrí Chats.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4">
            {msgs.length === 0 ? (
              <p className="mt-6 text-center text-sm text-muted-fg">
                Mandale un mensaje a Roby para arrancar.
              </p>
            ) : (
              <ul className="space-y-3 py-2 text-sm">
                {msgs.map((m, i) => (
                  <li
                    key={i}
                    className={
                      m.role === "user"
                        ? "ml-8 rounded-md bg-primary/15 px-3 py-2 text-foreground"
                        : "mr-8 rounded-md border border-border bg-muted/30 px-3 py-2"
                    }
                  >
                    {m.pending ? (
                      <span className="italic text-muted-fg">Roby está pensando…</span>
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                  </li>
                ))}
                <div ref={endRef} />
              </ul>
            )}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder="Escribí y enter para enviar (shift+enter = nueva línea)…"
                className="min-h-[44px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                disabled={busy}
              />
              <Button
                size="sm"
                variant="default"
                onClick={() => void send()}
                disabled={busy || !draft.trim()}
                title="Enviar"
              >
                <Send size={14} /> {busy ? "…" : ""}
              </Button>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-fg">
              <span>POST /projects/0/super-agent/chat</span>
              <button
                type="button"
                onClick={() => setMsgs([])}
                className="hover:text-foreground"
                disabled={busy || msgs.length === 0}
              >
                Limpiar
              </button>
            </div>
          </div>

          {/* Replace the default Close button position so it doesn't overlap
              the title; the sheet still closes on outside click + ESC. */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 text-muted-fg hover:text-foreground"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}
