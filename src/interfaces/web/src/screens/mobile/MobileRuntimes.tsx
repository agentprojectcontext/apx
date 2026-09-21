import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { CircleAlert, CircleCheck, Loader, PlugZap, TerminalSquare } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Loading } from "../../components/ui";
import { AgentAvatar } from "../../components/agents/AgentAvatar";
import { Runtimes, type RuntimeSession } from "../../lib/api/runtimes";
import { RuntimeRoomView } from "../../components/runtime/RuntimeConversation";
import { MobileChip, MobileGroupHeader, MobileListHeader } from "./mobileList";
import { relativeWhen } from "../../lib/when";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

const PAGE = 60;

/**
 * Every session an external runtime ran, and a way to say more to one.
 *
 * "Así puedo ver qué hacen, qué hablan y qué sesiones vas lanzando" (Manu,
 * 2026-09-20). Until now a launch left a record nothing read: on that same
 * afternoon nine Claude Code sessions ran, six died at a deadline, and the only
 * account of any of it was what the agent that launched them said — which was
 * that they were running.
 *
 * WRITING HERE GOES TO THE RUNTIME, not to the agent that launched it ("si yo
 * escribo ahí le llegará a Claude y vos no hacés nada"). The message resumes
 * that session — same engine, same folder, its own title and last prompt as
 * context — and the new run narrates itself back into the chat it belongs to.
 */
export function MobileRuntimes({ onBack }: { onBack?: () => void }) {
  const [query, setQuery] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [open, setOpen] = useState<RuntimeSession | null>(null);
  const [params, setParams] = useSearchParams();

  const { data, isLoading } = useSWR(
    "mobile-runtimes",
    () => Runtimes.list(PAGE),
    { revalidateOnFocus: true, keepPreviousData: true, refreshInterval: 15000 },
  );
  const sessions = useMemo(() => data?.items ?? [], [data]);

  // Opened from the chat list. The inbox lists a session as a room like every
  // other conversation, and tapping it has to land ON that session — not on a
  // list with it somewhere in the middle.
  const wanted = params.get("session");
  useEffect(() => {
    if (!wanted || open?.id === wanted) return;
    const row = sessions.find((s) => s.id === wanted);
    if (row) setOpen(row);
  }, [wanted, sessions, open]);

  const closeSheet = () => {
    setOpen(null);
    if (params.has("session")) {
      const next = new URLSearchParams(params);
      next.delete("session");
      next.delete("pid");
      // `replace`: closing a sheet is not a place you should have to go BACK out of.
      setParams(next, { replace: true });
    }
  };

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    let out = sessions;
    if (onlyFailed) out = out.filter((s) => s.failed);
    if (q) {
      out = out.filter((s) => [s.id, s.runtime, s.project_name, s.result, s.cwd]
        .some((f) => String(f || "").toLowerCase().includes(q)));
    }
    return out;
  }, [sessions, onlyFailed, q]);

  // Running first — those are the ones you might still want to say something
  // to. The rest keep the newest-first order the daemon sent.
  //
  // THREE GROUPS, NOT TWO. An open record is not a running process: nothing
  // closes the file when the daemon is killed mid-run, so "🔄 In progress"
  // outlives the run by however long the file sits there. Reading it as
  // "running" put a session from eleven days ago at the top of the screen under
  // a spinner — "¿por qué estos dos se ven corriendo si ya terminaron?" (Manu,
  // 2026-09-20). The daemon now says which open records are too old to be live
  // (`abandoned`), and those get a shelf of their own rather than being folded
  // in with the runs that finished — they did not finish, they were cut off.
  const groups = useMemo(() => {
    const live = shown.filter((s) => !s.done && !s.abandoned);
    const cut = shown.filter((s) => !s.done && s.abandoned);
    const past = shown.filter((s) => s.done);
    return [
      ...(live.length ? [{ key: "live", label: t("mobile.runtimes_running"), rows: live }] : []),
      ...(cut.length ? [{ key: "cut", label: t("mobile.runtimes_abandoned"), rows: cut }] : []),
      ...(past.length ? [{ key: "past", label: t("mobile.runtimes_finished"), rows: past }] : []),
    ];
  }, [shown]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <MobileListHeader
        title={t("mobile.runtimes_title")}
        onBack={onBack}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t("mobile.runtimes_search")}
        filters={[
          <MobileChip key="all" active={!onlyFailed} onClick={() => setOnlyFailed(false)} testId="mobile-runtimes-filter-all">
            {t("mobile.runtimes_all")}
          </MobileChip>,
          <MobileChip key="failed" active={onlyFailed} onClick={() => setOnlyFailed(true)} testId="mobile-runtimes-filter-failed">
            {t("mobile.runtimes_failed")}
          </MobileChip>,
        ]}
      />

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="mobile-runtimes-list">
        {isLoading && !data && <div className="py-10"><Loading /></div>}

        {!isLoading && shown.length === 0 && (
          <p className="px-4 py-16 text-center text-sm text-muted-fg">
            <TerminalSquare size={20} className="mx-auto mb-2 opacity-50" />
            {q || onlyFailed ? t("inbox.no_match") : t("mobile.runtimes_empty")}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.key}>
            <MobileGroupHeader label={group.label} count={group.rows.length} />
            <ul className="divide-y divide-border/60">
              {group.rows.map((s) => (
                <RuntimeRow key={`${s.project_id}-${s.id}`} session={s} onOpen={() => setOpen(s)} />
              ))}
            </ul>
          </section>
        ))}
        <div className="h-4" />
      </div>

      <RuntimeSheet session={open} onClose={closeSheet} />
    </div>
  );
}

/** Running / cut off / done / failed, in one glyph. The spinner is reserved for
 *  work that is actually happening: an open record nothing is running any more
 *  gets the unplugged mark, because a spinner is a promise that it will move. */
function StatusIcon({ session, className }: { session: RuntimeSession; className?: string }) {
  if (session.abandoned) return <PlugZap className={cn("size-4 text-muted-fg", className)} />;
  if (!session.done) return <Loader className={cn("size-4 animate-spin text-primary", className)} />;
  if (session.failed) return <CircleAlert className={cn("size-4 text-amber-500", className)} />;
  return <CircleCheck className={cn("size-4 text-emerald-500", className)} />;
}

function RuntimeRow({ session, onOpen }: { session: RuntimeSession; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`mobile-runtime-${session.id}`}
        className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left active:bg-accent/50"
      >
        {/* The engine's own face: AgentAvatar ships a logo for claude and codex,
            so a list of sessions reads as a list of who ran them. */}
        <AgentAvatar icon={session.runtime} emoji={null} name={session.runtime || "?"} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <StatusIcon session={session} />
            <span className="min-w-0 truncate text-[15px] font-medium">{session.runtime || t("mobile.runtimes_unknown")}</span>
            <span className="shrink-0 text-[11px] text-muted-fg">{session.started ? relativeWhen(session.started, t as never) : ""}</span>
          </span>
          {session.result && (
            <span className="mt-0.5 block truncate text-xs text-muted-fg">{session.result}</span>
          )}
          <span className="mt-0.5 block truncate text-[11px] text-muted-fg/70">
            {[session.id, session.project_name?.split("/").pop(), session.cwd?.split("/").pop()].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}

/** One session, as the chat it is. The paperwork lives behind the ℹ. */
function RuntimeSheet({ session, onClose }: {
  session: RuntimeSession | null;
  onClose: () => void;
}) {
  if (!session) return null;
  return (
    <Sheet open={!!session} onOpenChange={(v) => { if (!v) onClose(); }}>
      {/* `data-[side=bottom]:` — NOT a plain `h-[88vh]`. The sheet's own variant
            sets `data-[side=bottom]:h-auto`, and a data-attribute selector wins
            on specificity, so the plain class was ignored: a long session grew
            the sheet to 9193px and pushed its own ✕ off the top of the screen
            with no way to close it (Manu, 2026-09-20). */}
        <SheetContent side="bottom" className="flex data-[side=bottom]:h-[88vh] flex-col gap-0 rounded-t-2xl p-0">
        {/* The title is the room's own header, so the sheet does not draw a
            second one above it. Screen readers still get one. */}
        <SheetHeader className="sr-only">
          <SheetTitle>{session.runtime || t("mobile.runtimes_unknown")}</SheetTitle>
        </SheetHeader>
        {/* The sessions list is where a RUN is the subject, so this keeps the
            execution detail on screen. The chat-shaped view is what the chat
            list opens — a different question about the same session. */}
        <RuntimeRoomView
          variant="detail"
          projectId={session.project_id}
          sessionId={session.id}
          runtime={session.runtime}
          projectName={session.project_name}
          onClose={onClose}
        />
      </SheetContent>
    </Sheet>
  );
}
