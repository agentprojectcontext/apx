import { useMemo, useState } from "react";
import useSWR from "swr";
import { CalendarClock, Check, ExternalLink, Handshake, Trash2, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { CommitmentBadge, CommitmentIcon, commitmentFace, commitmentTint } from "../../components/commitments/commitmentState";
import { useToast } from "../../components/Toast";
import { Loading } from "../../components/ui";
import { Commitments, type CommitmentState, type GlobalCommitmentEntry } from "../../lib/api/commitments";
import { DueChip, MobileChip, MobileGroupHeader, MobileListHeader, dueBucketLabel, groupByDue } from "./mobileList";
import { SheetAction } from "./MobileTasks";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

type Filter = CommitmentState | "all";
const FILTERS: Filter[] = ["open", "kept", "missed", "dropped", "all"];

const PAGE = 50;

/** Stable identity for "nothing yet", so the memos below can actually memo. */
const NONE: GlobalCommitmentEntry[] = [];

/**
 * What you owe people, on the phone.
 *
 * The sibling of tasks and a different question: a task is work, a commitment
 * is someone waiting. That is why the row leads with the NAME — you scan this
 * list for a person, not for a verb — and why the only thing coloured red is a
 * date that has already passed.
 */
export function MobileCommitments() {
  const [state, setState] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState(1);
  const [open, setOpen] = useState<GlobalCommitmentEntry | null>(null);

  const limit = PAGE * pages;
  const { data, isLoading, mutate } = useSWR(
    `mobile-commitments:${state}:${limit}`,
    () => Commitments.globalPage({ state, limit, offset: 0 }),
    { revalidateOnFocus: true, keepPreviousData: true },
  );
  const items = data?.items ?? NONE;
  const total = data?.total ?? 0;

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return items;
    return items.filter((c) =>
      [c.counterparty, c.body, c.project_name].some((f) => String(f || "").toLowerCase().includes(q)),
    );
  }, [items, q]);

  const groups = useMemo(
    () => groupByDue(shown, (c) => c.due, { keep: state === "open" }),
    [shown, state],
  );

  const changeState = (next: Filter) => {
    setState(next);
    setPages(1);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <MobileListHeader
        title={t("mobile.tab_commitments")}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t("mobile.commitments_search")}
        filters={FILTERS.map((s) => (
          <MobileChip
            key={s}
            active={state === s}
            onClick={() => changeState(s)}
            testId={`mobile-commitment-filter-${s}`}
          >
            {t(`project.commitments.state.${s}` as never)}
          </MobileChip>
        ))}
      />

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="mobile-commitment-list">
        {isLoading && !data && <div className="py-10"><Loading /></div>}

        {!isLoading && shown.length === 0 && (
          <p className="px-4 py-16 text-center text-sm text-muted-fg">
            <Handshake size={20} className="mx-auto mb-2 opacity-50" />
            {q ? t("inbox.no_match") : t("project.commitments.empty")}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.bucket ?? "all"}>
            {group.bucket && (
              <MobileGroupHeader label={dueBucketLabel(group.bucket)} count={group.rows.length} />
            )}
            <ul className="divide-y divide-border/60">
              {group.rows.map((c) => (
                <CommitmentRow key={`${c.project_id}-${c.id}`} commitment={c} onOpen={() => setOpen(c)} />
              ))}
            </ul>
          </section>
        ))}

        {items.length < total && (
          <button
            type="button"
            onClick={() => setPages((n) => n + 1)}
            data-testid="mobile-commitments-more"
            className="w-full py-4 text-center text-sm font-medium text-primary active:bg-accent/50"
          >
            {t("mobile.load_more", { count: total - items.length })}
          </button>
        )}
        <div className="h-4" />
      </div>

      <CommitmentSheet commitment={open} onClose={() => setOpen(null)} onChanged={() => void mutate()} />
    </div>
  );
}

function CommitmentRow({ commitment, onOpen }: { commitment: GlobalCommitmentEntry; onOpen: () => void }) {
  const face = commitmentFace(commitment);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`mobile-commitment-${commitment.id}`}
        className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-accent/50"
      >
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", commitmentTint(face))}>
          <CommitmentIcon face={face} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{commitment.counterparty}</span>
            <DueChip due={commitment.due} late={face === "overdue"} />
          </span>
          <span className={cn(
            "mt-0.5 block text-sm leading-snug [overflow-wrap:anywhere] line-clamp-2",
            commitment.state === "open" ? "text-foreground/90" : "text-muted-fg",
          )}>
            {commitment.body}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-fg">
            {[commitment.project_name?.split("/").pop(), !commitment.due ? t("project.commitments.no_date") : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * One promise, with the four things you can do about it.
 *
 * "Reprogramar" asks for the new date inline instead of confirming a verb: the
 * store refuses a renegotiation with no date on purpose ("moved it, no idea
 * until when" is how a promise disappears), so the date is the action.
 */
function CommitmentSheet({
  commitment, onClose, onChanged,
}: {
  commitment: GlobalCommitmentEntry | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  if (!commitment) return null;
  const pid = String(commitment.project_id);

  const close = () => { setMoveTo(null); onClose(); };
  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      onChanged();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(v) => { if (!v) close(); }}>
      <SheetContent side="bottom" className="max-h-[85vh] gap-0 rounded-t-2xl p-0" data-testid="mobile-commitment-sheet">
        <SheetHeader className="gap-2 border-b border-border px-4 pb-3 pt-4">
          <SheetTitle className="pr-8 text-left text-base">{commitment.counterparty}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2">
            <CommitmentBadge face={commitmentFace(commitment)} />
            <span className="text-[11px] text-muted-fg">
              {commitment.due
                ? `${t("project.commitments.field_due")}: ${String(commitment.due).slice(0, 10)}`
                : t("project.commitments.no_date")}
            </span>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{commitment.body}</p>
          <dl className="mt-4 space-y-1.5 text-xs text-muted-fg">
            <SheetField label={t("nav.project")} value={commitment.project_name} />
            <SheetField label={t("project.commitments.promised")} value={commitment.promised_at?.slice(0, 10)} />
            <SheetField label={t("project.commitments.field_note")} value={commitment.note} />
          </dl>
          {/* Every date this promise has had. Two moves is a fact about the
              relationship and it only exists if it is shown. */}
          {!!commitment.history?.length && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
                {t("project.commitments.history_title")}
              </p>
              <ul className="mt-1 space-y-1 text-xs text-muted-fg">
                {commitment.history.map((h, i) => (
                  <li key={`${h.moved_at}-${i}`}>
                    {t("project.commitments.moved")} · {String(h.due ?? "—").slice(0, 10)} → {h.moved_at.slice(0, 10)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {moveTo !== null && (
            <div className="mt-4 rounded-xl border border-border p-3">
              <label className="block text-xs font-medium text-muted-fg" htmlFor="commitment-move-to">
                {t("project.commitments.field_due")}
              </label>
              <input
                id="commitment-move-to"
                type="date"
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                data-testid="mobile-commitment-move-date"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-[15px] outline-none focus:border-primary/50"
              />
              <p className="mt-1.5 text-[11px] text-muted-fg">{t("project.commitments.field_due_move_hint")}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          {moveTo !== null ? (
            <div className="flex gap-2">
              <SheetAction
                icon={<X size={16} />}
                label={t("common.cancel")}
                busy={busy}
                onClick={() => setMoveTo(null)}
              />
              <SheetAction
                icon={<CalendarClock size={16} />}
                label={t("mobile.commitment_move")}
                primary
                busy={busy || !moveTo}
                testId="mobile-commitment-move-confirm"
                onClick={() => act(
                  () => Commitments.renegotiate(pid, commitment.id, moveTo),
                  t("mobile.commitment_moved_toast"),
                )}
              />
            </div>
          ) : commitment.state === "open" ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <SheetAction
                  icon={<Check size={16} />}
                  label={t("project.commitments.mark_kept")}
                  primary
                  busy={busy}
                  testId="mobile-commitment-kept"
                  onClick={() => act(() => Commitments.kept(pid, commitment.id), t("project.commitments.face.kept"))}
                />
                <SheetAction
                  icon={<CalendarClock size={16} />}
                  label={t("mobile.commitment_move")}
                  busy={busy}
                  testId="mobile-commitment-move"
                  // Prefilled with the date it already has, so the common case
                  // (push it a few days) is a nudge and not a fresh entry.
                  onClick={() => setMoveTo(String(commitment.due ?? "").slice(0, 10))}
                />
              </div>
              <div className="flex gap-2">
                <SheetAction
                  icon={<X size={16} />}
                  label={t("project.commitments.mark_missed")}
                  tone="danger"
                  busy={busy}
                  testId="mobile-commitment-missed"
                  onClick={() => act(() => Commitments.missed(pid, commitment.id), t("project.commitments.face.missed"))}
                />
                <SheetAction
                  icon={<Trash2 size={16} />}
                  label={t("project.commitments.mark_dropped")}
                  busy={busy}
                  testId="mobile-commitment-drop"
                  onClick={() => act(() => Commitments.drop(pid, commitment.id), t("project.commitments.dropped_toast"))}
                />
                <PanelLink pid={pid} id={commitment.id} />
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {/* A closed promise has no verbs here on purpose: reopening one is
                  agreeing a NEW date with a person, which is the panel's form
                  and not a one-tap undo. */}
              <p className="min-w-0 flex-1 self-center text-xs text-muted-fg">
                {t("mobile.commitment_closed")}
              </p>
              <PanelLink pid={pid} id={commitment.id} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PanelLink({ pid, id }: { pid: string; id: string }) {
  return (
    <a
      href={`/p/${pid}/commitments?c_id=${encodeURIComponent(id)}`}
      target="_blank"
      rel="noopener"
      aria-label={t("inbox.open_in_project")}
      className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-fg active:bg-accent/60"
    >
      <ExternalLink size={16} />
    </a>
  );
}

function SheetField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 text-foreground">{value}</dd>
    </div>
  );
}
