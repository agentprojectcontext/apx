import { useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Info, SendHorizontal, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useToast } from "../Toast";
import { Runtimes, type RuntimeRoomMessage } from "../../lib/api/runtimes";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * A launched coding session, as a chat.
 *
 * It opened as a FICHA first — folder, start, finish, launched-by, notes, then
 * the transcript underneath — because the screen it grew out of was a list of
 * session records. Manu, the moment he opened one from the chat list: "no
 * entiendo por qué se ve así y no como un chat común… esta data de carpeta,
 * arrancó, terminó, podría ser un botón de info". He is right: a room reached
 * from a list of conversations is a conversation, and the paperwork is what you
 * ask for, not what you are handed.
 *
 * So the facts are behind the ℹ, and the only ones that stay on screen are the
 * two that say WHICH session this is: the engine, and the folder it opened in.
 * The folder is on the header for a reason of its own — nine sessions on
 * 2026-09-20 ran in the wrong one and nothing on screen said so.
 *
 * Shared by the phone and the panel, deliberately: a second transcript renderer
 * would be free to disagree with the first about who said what, which is the
 * confusion this room exists to end.
 */
export function RuntimeRoomView({
  projectId, sessionId, runtime, projectName, variant = "chat", onBack, onClose, className,
}: {
  projectId: string | number;
  sessionId: string;
  runtime?: string | null;
  projectName?: string | null;
  /**
   * WHICH OF THE TWO THINGS A SESSION IS.
   *
   * "chat" — reached from the list of conversations, so it IS one: bubbles, a
   *   back button, and the paperwork behind the ℹ. "no entiendo por qué se ve
   *   así y no como un chat común" (Manu, 2026-09-20).
   * "detail" — reached from the sessions list, where the run itself is the
   *   subject: the execution facts on screen, transcript underneath. That view
   *   was right and the first pass took it away from both. "sacaste la info en
   *   esta vista que estaba bien".
   */
  variant?: "chat" | "detail";
  onBack?: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const { data: room, mutate } = useSWR(
    `/api/projects/${projectId}/runtime-rooms/${sessionId}`,
    () => Runtimes.room(String(projectId), sessionId),
    { refreshInterval: 10000, keepPreviousData: true },
  );
  // The record: only the ℹ sheet reads it, so it is fetched only when opened.
  // In "detail" they are the point of the screen, so they load with it; in
  // "chat" they are behind the ℹ and cost nothing until it is opened.
  const { data: facts } = useSWR(
    variant === "detail" || infoOpen ? `/api/projects/${projectId}/runtime-sessions/${sessionId}` : null,
    () => Runtimes.get(String(projectId), sessionId),
  );

  const engine = room?.runtime || runtime || "runtime";
  const cwd = room?.cwd || null;

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
      {/* The thread's own bar, the same shape every other thread header has.
          The second line is the FOLDER, not the project: two sessions of the
          same engine in the same project are told apart by where they opened. */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            data-testid="runtime-back"
            aria-label={t("mobile.back")}
            className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-fg transition-colors active:bg-accent/60 hover:text-fg"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <AgentAvatar icon={engine} emoji={null} name={engine} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{engine}</p>
          <p className="truncate text-[11px] text-muted-fg" title={cwd || undefined}>
            {[cwd, projectName || room?.project_name, sessionId].filter(Boolean).join(" · ")}
          </p>
        </div>
        {variant === "chat" && (
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          data-testid="runtime-info"
          aria-label={t("mobile.runtimes_info")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-fg transition-colors active:bg-accent/60 hover:text-fg"
        >
          <Info size={17} />
        </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-fg transition-colors active:bg-accent/60 hover:text-fg"
          >
            <X size={17} />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" data-testid="runtime-thread">
        {variant === "detail" && <RuntimeFacts {...{ engine, cwd, facts, room, projectName }} />}
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

      {/* The paperwork, on request. Bottom sheet on both surfaces: it is the
          same set of facts, and a second layout for the panel would be a second
          place for them to fall out of date. */}
      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] gap-0 rounded-t-2xl p-0">
          <SheetHeader className="border-b border-border px-4 pb-3 pt-4">
            <SheetTitle className="text-left text-base">{t("mobile.runtimes_info")}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <RuntimeFacts {...{ engine, cwd, facts, room, projectName }} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** What this run WAS: engine, folder, who started it, when it began and ended,
 *  and whatever notes it left. On screen in "detail", behind the ℹ in "chat" —
 *  one block either way, because two would be two things to keep in step. */
function RuntimeFacts({ engine, cwd, facts, room, projectName }: {
  engine: string;
  cwd: string | null;
  facts?: { started?: string | null; completed?: string | null; body?: string } | null;
  room?: { launched_by?: string | null; project_name?: string } | null;
  projectName?: string | null;
}) {
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]" data-testid="runtime-facts">
        {([
          [t("mobile.runtimes_new_engine"), engine],
          [t("mobile.runtimes_cwd"), cwd],
          [t("nav.project"), projectName || room?.project_name],
          [t("mobile.runtimes_agent"), room?.launched_by],
          [t("mobile.runtimes_started"), facts?.started],
          [t("mobile.runtimes_completed"), facts?.completed],
        ] as [string, string | null | undefined][])
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-fg">{label}</dt>
              <dd className="min-w-0 break-all">{value}</dd>
            </div>
          ))}
      </dl>
      {facts?.body ? (
        <div className="mt-3 space-y-1">
          <span className="text-xs font-medium text-muted-fg">{t("mobile.runtimes_notes")}</span>
          <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-[12px] leading-relaxed text-muted-fg">
            {facts.body}
          </p>
        </div>
      ) : null}
    </>
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
