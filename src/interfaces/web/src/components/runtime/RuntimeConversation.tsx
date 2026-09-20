import { useState } from "react";
import useSWR from "swr";
import { SendHorizontal } from "lucide-react";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useToast } from "../Toast";
import { Runtimes, type RuntimeRoomMessage } from "../../lib/api/runtimes";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * A launched coding session, as a conversation you can answer.
 *
 * Shared by the phone (inside the runtimes sheet) and the panel (inline in the
 * inbox pane) because it is the same conversation: the alternative was a second
 * transcript renderer, free to disagree with the first about who said what —
 * which is the exact confusion this screen exists to end.
 */
export function RuntimeConversation({ projectId, sessionId, runtime, className }: {
  projectId: string | number;
  sessionId: string;
  runtime?: string | null;
  className?: string;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: room, mutate } = useSWR(
    `/api/projects/${projectId}/runtime-rooms/${sessionId}`,
    () => Runtimes.room(String(projectId), sessionId),
    { refreshInterval: 10000, keepPreviousData: true },
  );
  const engine = room?.runtime || runtime || "runtime";

  const send = async () => {
    const prompt = text.trim();
    if (!prompt) return;
    setBusy(true);
    try {
      await Runtimes.continue_(String(projectId), sessionId, prompt);
      toast.success(t("mobile.runtimes_sent"));
      setText("");
      // Stay in the room: the answer lands here, and closing on send was right
      // only while this was a form rather than a conversation.
      void mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" data-testid="runtime-thread">
        {room?.messages?.length
          ? room.messages.map((m, i) => <RuntimeLine key={`${m.ts || i}-${i}`} msg={m} />)
          : <p className="text-[12px] text-muted-fg">{t("mobile.runtimes_empty_thread")}</p>}
      </div>

      {/* Straight to the engine. Not a message to the agent that launched it —
          it reopens THIS session, with its own context. */}
      <div className="shrink-0 space-y-1 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder={t("mobile.runtimes_reply_ph", { runtime: engine })}
            data-testid="runtime-composer"
            className="min-h-[42px] flex-1 resize-none rounded-lg border border-border bg-muted/30 px-3 py-2 text-[15px] outline-none placeholder:text-muted-fg focus:border-primary/50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !text.trim()}
            data-testid="runtime-send"
            aria-label={t("mobile.runtimes_send")}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg disabled:opacity-50"
          >
            <SendHorizontal size={17} />
          </button>
        </div>
        <p className="text-[11px] text-muted-fg">{t("mobile.runtimes_reply_hint")}</p>
      </div>
    </div>
  );
}

/**
 * One line of a session, in whichever of the three voices said it.
 *
 * From the engine's side there is ONE user: `claude -p` takes a prompt and does
 * not care who typed it, so a prompt Roby sent and a prompt the owner sent
 * arrived identically. The room is the only place that difference survives, and
 * this is where it gets drawn:
 *
 *   the owner  → their own bubble, on the right, like any chat
 *   an agent   → its own name, on the left, tagged "en tu nombre" — because
 *                that is exactly what it was
 *   the engine → its own name and its own logo, on the left
 *
 * Asked for in those words on 2026-09-20: "el agente habla como agente pero
 * claude recibe como yo mismo, y yo veo los 3 tipos: mi mensaje, el del agente
 * y el de claude".
 */
export function RuntimeLine({ msg }: { msg: RuntimeRoomMessage }) {
  if (msg.role === "tool") return null;
  const mine = msg.role === "user";
  const who = msg.agent_name || msg.agent || "";
  const isEngine = msg.actor_kind === "engine";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0 max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
        mine ? "bg-primary/10" : isEngine ? "bg-muted/60" : "bg-muted/30")}>
        <div className="mb-0.5 flex items-center gap-1.5">
          {!mine && <AgentAvatar icon={isEngine ? msg.agent : null} emoji={null} name={who || "?"} size={16} />}
          <span className="truncate text-[11px] font-medium text-muted-fg">
            {mine ? t("mobile.runtimes_you") : who}
          </span>
          {msg.on_behalf_of && (
            <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[10px] text-sky-600 dark:text-sky-400">
              {t("mobile.runtimes_on_behalf")}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
      </div>
    </div>
  );
}
