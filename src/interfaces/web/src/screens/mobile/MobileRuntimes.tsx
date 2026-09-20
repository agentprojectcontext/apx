import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { CircleAlert, CircleCheck, Loader, TerminalSquare } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Loading } from "../../components/ui";
import { AgentAvatar } from "../../components/agents/AgentAvatar";
import { Runtimes, type RuntimeSession } from "../../lib/api/runtimes";
import { RuntimeConversation } from "../../components/runtime/RuntimeConversation";
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
export function MobileRuntimes() {
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
  const groups = useMemo(() => {
    const live = shown.filter((s) => !s.done);
    const past = shown.filter((s) => s.done);
    return [
      ...(live.length ? [{ key: "live", label: t("mobile.runtimes_running"), rows: live }] : []),
      ...(past.length ? [{ key: "past", label: t("mobile.runtimes_finished"), rows: past }] : []),
    ];
  }, [shown]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <MobileListHeader
        title={t("mobile.runtimes_title")}
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

/** Running / done / failed, in one glyph. */
function StatusIcon({ session, className }: { session: RuntimeSession; className?: string }) {
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

/** One session: what it was asked, how it ended, and a box to say more. */
function RuntimeSheet({ session, onClose }: {
  session: RuntimeSession | null;
  onClose: () => void;
}) {
  const { data: full } = useSWR(
    session ? `/api/projects/${session.project_id}/runtime-sessions/${session.id}` : null,
    () => Runtimes.get(String(session!.project_id), session!.id),
  );
  // The session as a CONVERSATION. The record above says what this session IS;
  // this says what was said in it, which is the half that was missing — a
  // launch used to leave a receipt you could read and not answer.

  if (!session) return null;
  const live = full ?? session;

  return (
    <Sheet open={!!session} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="flex max-h-[88vh] flex-col p-0">
        <SheetHeader className="shrink-0 space-y-2 border-b border-border px-4 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <AgentAvatar icon={session.runtime} emoji={null} name={session.runtime || "?"} size={40} />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-left text-base">
                {session.runtime || t("mobile.runtimes_unknown")}
              </SheetTitle>
              <p className="truncate text-xs text-muted-fg">
                {[session.id, session.project_name?.split("/").pop()].filter(Boolean).join(" · ")}
              </p>
            </div>
            <StatusIcon session={session} className="size-5" />
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]" data-testid="mobile-runtime-facts">
            {([
              [t("mobile.runtimes_started"), live.started],
              [t("mobile.runtimes_completed"), live.completed],
              [t("mobile.runtimes_cwd"), live.cwd],
              [t("mobile.runtimes_agent"), live.agent],
            ] as [string, string | null | undefined][])
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-fg">{label}</dt>
                  <dd className="min-w-0 break-all">{value}</dd>
                </div>
              ))}
          </dl>

          {"body" in live && live.body ? (
            <div className="mt-3 space-y-1">
              <span className="text-xs font-medium text-muted-fg">{t("mobile.runtimes_notes")}</span>
              <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-[12px] leading-relaxed text-muted-fg">{live.body}</p>
            </div>
          ) : null}
        </div>

        <RuntimeConversation
          projectId={session.project_id}
          sessionId={session.id}
          runtime={session.runtime}
          className="min-h-[38vh] border-t border-border"
        />
      </SheetContent>
    </Sheet>
  );
}

