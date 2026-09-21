import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Info, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { AgentAvatar, type AgentFace } from "../agents/AgentAvatar";
import { MessageList } from "../chat/MessageList";
import { Composer } from "../chat/Composer";
import { useToast } from "../Toast";
import { Runtimes, type RuntimeRoomMessage } from "../../lib/api/runtimes";
import type { ChatMsg } from "../../hooks/useChat";
import { countSaying, isAnswering, toChatMsgs } from "../../lib/runtime-room";
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
 * AND IT IS THE PANEL'S OWN CHAT, not a second one that looks like it. The
 * first pass hand-rolled bubbles and a textarea, and every difference was a
 * bug: the draft stayed in the box after sending ("no sale el mensaje"), there
 * was nothing on screen between sending and the answer landing ("no veo si está
 * contestando"), and the thread had none of the day dividers, markdown, copy or
 * attachment handling every other thread has. "¿Por qué no usamos el modo chat
 * normal pero con ruta runtime?" (Manu, 2026-09-20) — so it does: `MessageList`
 * and `Composer`, the same two components the agent chats are made of, over the
 * room's own messages.
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
   * "chat" — reached from the list of conversations, so it IS one: the real
   *   chat surface, a back button, and the paperwork behind the ℹ. "no entiendo
   *   por qué se ve así y no como un chat común" (Manu, 2026-09-20).
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
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  /**
   * The prompt this tab just sent, held until the room comes back carrying it.
   *
   * A run takes minutes and the room is polled, so between the send and the
   * next poll there was nothing on screen at all: the words were gone from the
   * composer and not yet in the thread, which reads as a message that failed to
   * send. Held here, the turn appears the instant it is sent and the engine's
   * pending reply sits under it — and both are dropped the moment the poll
   * returns a room that already contains the prompt, so nothing is ever drawn
   * twice.
   */
  const [sent, setSent] = useState<{ text: string; ts: string; seen: number } | null>(null);

  const { data: room, mutate } = useSWR(
    `/api/projects/${projectId}/runtime-rooms/${sessionId}`,
    () => Runtimes.room(String(projectId), sessionId),
    {
      // Fast while the engine owes an answer, slow once it has given one.
      // The poll IS the delivery here — a run lands in the room and nothing
      // pushes — so four seconds of staleness is the difference between "it is
      // working" and "it is stuck", and ten is plenty for a finished session
      // nobody is waiting on.
      refreshInterval: (data) => (isAnswering(data?.messages ?? []) ? 4000 : 10000),
      keepPreviousData: true,
    },
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
  const lines = useMemo(() => room?.messages ?? [], [room]);

  // Our own turn is dropped as soon as the room has it: the ledger is the
  // truth, and a local copy that outlived it would double the message.
  //
  // By COUNT, not by presence. Asking the same thing twice — "dale", "seguí" —
  // is ordinary, and a presence check would see the first copy already in the
  // thread and drop the second one off the screen the instant it was sent.
  const landed = !!sent && countSaying(lines, sent.text) > sent.seen;
  useEffect(() => {
    if (landed) setSent(null);
  }, [landed]);

  // The waiting bubble is decided inside `toChatMsgs`, off the room itself —
  // deliberately NOT passed to the composer as `streaming`. That would swap
  // send for a stop button, and nothing here can call an engine back: a stop
  // that does nothing is worse than no stop. Writing to a session while it
  // works is allowed on purpose — "si yo le digo que se colgó" is exactly the
  // message that must get through.
  const msgs = useMemo(
    () => toChatMsgs(lines, engine, landed ? null : sent),
    [lines, engine, landed, sent],
  );

  // Who to draw beside a turn: the engine wears its brand mark, an agent its
  // own name. One resolver so the thread and the header cannot disagree.
  const faceFor = (m: ChatMsg): AgentFace => ({
    slug: m.agentId,
    name: m.agent || engine,
    icon: m.agentId === engine ? engine : null,
  });

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    setBusy(true);
    setSent({ text: prompt, ts: new Date().toISOString(), seen: countSaying(lines, prompt) });
    try {
      await Runtimes.continue_(String(projectId), sessionId, prompt);
      void mutate();
    } catch (e) {
      // The turn never left, so neither should the words: put them back rather
      // than leaving a bubble on screen for something that did not happen.
      setSent(null);
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

      {variant === "detail" ? (
        // The run is the subject here, so the facts lead and the transcript
        // follows in the compact shape a record has — this screen is read, not
        // scrolled through.
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" data-testid="runtime-thread">
          <RuntimeFacts {...{ engine, cwd, facts, room, projectName }} />
          {lines.length
            ? lines.map((m, i) => <RuntimeLine key={`${m.ts || i}-${i}`} msg={m} />)
            : <p className="text-[12px] text-muted-fg">{t("mobile.runtimes_empty_thread")}</p>}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="runtime-thread">
          <MessageList
            msgs={msgs}
            compact
            showSpeaker
            showTools={false}
            faceFor={faceFor}
            onCopy={(text) => void navigator.clipboard?.writeText(text)}
          />
        </div>
      )}

      {/* Straight to the engine. Not a message to the agent that launched it —
          it reopens THIS session, with its own context. */}
      <div className="shrink-0 border-t border-border">
        <Composer
          onSend={(text) => void send(text)}
          onStop={() => { /* the engine owns its run; nothing here can call it back */ }}
          streaming={busy}
          placeholder={t("mobile.runtimes_reply_ph", { runtime: engine })}
          context={<span className="px-1 text-[11px] text-muted-fg">{t("mobile.runtimes_reply_hint")}</span>}
        />
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
 * One line of a session in the RECORD's shape — tight, unstyled, readable in a
 * column beside the execution facts. The chat shape is `toChatMsgs` (lib/runtime-room.ts); this
 * is what the sessions list shows under the ficha, where a full chat surface
 * would bury the thing the screen is for.
 */
export function RuntimeLine({ msg }: { msg: RuntimeRoomMessage }) {
  if (msg.role === "tool") return null;
  const mine = msg.role === "user" && !msg.on_behalf_of;
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
