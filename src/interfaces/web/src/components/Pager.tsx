import { useEffect, useState, type ReactNode } from "react";
import useSWR, { type SWRConfiguration } from "swr";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui";
import { UiSelect } from "./UiSelect";
import { cn } from "../lib/cn";
import { t } from "../i18n";

const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZES = [10, 20, 50, 100];

// The pager-facing slice of usePagedQuery's return value. PagedList/Pager only
// need these fields, so call sites can pass the whole query result structurally.
export interface PagerState {
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
}

// Server-side pagination. The daemon paginates by ?limit&?offset and returns
// the full count, so we fetch only the current page (real API pagination, not a
// client-side slice of everything). `fetchPage` is called with (limit, offset)
// and must return { items, total }. Pass `resetKey` (e.g. the active filter) to
// jump back to page 1 when the query changes; the page is also clamped so
// removing the last row on a page never strands the user on an empty page.
//
// Returns the page `items` plus SWR state (isLoading/error/mutate) and the
// PagerState fields consumed by <PagedList> / <Pager>.
export function usePagedQuery<T>({
  key,
  fetchPage,
  resetKey,
  initialPageSize = DEFAULT_PAGE_SIZE,
  swr,
}: {
  key: string | null;
  fetchPage: (limit: number, offset: number) => Promise<{ items: T[]; total: number }>;
  resetKey?: unknown;
  initialPageSize?: number;
  swr?: SWRConfiguration;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => { setPage(1); }, [resetKey]);

  const offset = (page - 1) * pageSize;
  const res = useSWR(
    key == null ? null : [key, pageSize, offset],
    () => fetchPage(pageSize, offset),
    { keepPreviousData: true, ...swr },
  );

  const total = res.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Clamp once totals are known (e.g. after the last row on a page is removed).
  const safePage = Math.min(page, pageCount);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  const start = total === 0 ? 0 : offset;
  const end = Math.min(offset + pageSize, total);
  return {
    items: (res.data?.items ?? []) as T[],
    isLoading: res.isLoading,
    error: res.error as Error | undefined,
    mutate: res.mutate,
    page: safePage,
    pageCount,
    total,
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

// Reusable list + pager wrapper. `children` is the list markup (built from
// `paged.slice`); the Pager is wired from `paged` automatically.
//
// With `fullHeight`, the list area becomes an internal scroller and the pager
// is pinned at the bottom, so the whole block fits one viewport with no outer
// page scroll. This requires the parent to give it a bounded height — render it
// inside <Section fullHeight> (which lays out as a flex column). Without the
// flag it falls back to normal document flow (list, then pager, page scrolls).
export function PagedList({
  paged,
  fullHeight,
  className,
  children,
}: {
  paged: PagerState;
  fullHeight?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const pager = (
    <Pager
      page={paged.page}
      pageCount={paged.pageCount}
      total={paged.total}
      start={paged.start}
      end={paged.end}
      pageSize={paged.pageSize}
      onPage={paged.setPage}
      onPageSize={paged.setPageSize}
    />
  );
  if (!fullHeight) {
    return (
      <div className={className}>
        {children}
        {pager}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
      <div className="shrink-0">{pager}</div>
    </div>
  );
}
