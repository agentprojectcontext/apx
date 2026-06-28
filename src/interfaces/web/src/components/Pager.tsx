import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui";
import { UiSelect } from "./UiSelect";
import { t } from "../i18n";

const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZES = [10, 20, 50, 100];

// Client-side pagination over an already-fetched array. The list endpoints
// return the full set (sessions/tasks are bounded), so we page in the browser
// rather than round-trip the daemon. Pass `resetKey` (e.g. the active filter)
// to jump back to page 1 whenever the source set changes; the window is also
// clamped so a shrinking list never strands the user on an empty page.
export function usePaged<T>(items: T[], resetKey?: unknown, initialPageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => { setPage(1); }, [resetKey]);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  const start = (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, items.length);
  return {
    slice: items.slice(start, end),
    page: safePage,
    pageCount,
    total: items.length,
    start,
    end,
    pageSize,
    setPage,
    // Changing the page size keeps things predictable by returning to page 1.
    setPageSize: (n: number) => { setPageSize(n); setPage(1); },
  };
}

export function Pager({
  page,
  pageCount,
  total,
  start,
  end,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  // Nothing to page when the whole set fits in the smallest page size.
  if (total <= PAGE_SIZES[0]) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-fg">
      <div className="flex items-center gap-3">
        <span className="tabular-nums">{t("common.pager_range", { from: start + 1, to: end, total })}</span>
        <span className="flex items-center gap-1.5">
          <span>{t("common.pager_per_page")}</span>
          <div className="w-[4.5rem]">
            <UiSelect
              value={String(pageSize)}
              onChange={(v) => onPageSize(Number(v))}
              options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </div>
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("common.pager_prev")}>
          <ChevronLeft size={14} />
        </Button>
        <span className="px-1 tabular-nums">{t("common.pager_page", { page, total: pageCount })}</span>
        <Button size="sm" variant="ghost" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label={t("common.pager_next")}>
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
