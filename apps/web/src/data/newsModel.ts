// The news as the panel shows them: by release, newest first, and the few lines the Help menu has room for.
import type { Result } from "@apx/protocol";

export type NewsItem = Result<"system.news">["entries"][number];
export type Release = { version: string; entries: NewsItem[] };

/** "2.11.2" against "2.9.0" by number; the panel keeps zod (the protocol's root) off its first load. */
const newer = (a: string, b: string): number => {
  const [x, y] = [a, b].map((v) => v.split(".").map((n) => Number(n) || 0));
  for (let i = 0; i < 3; i++) if ((x?.[i] ?? 0) !== (y?.[i] ?? 0)) return (y?.[i] ?? 0) - (x?.[i] ?? 0);
  return 0;
};

/** Newest release first; within one, the entries that apply to this owner first, in the order the release lists them. */
export function byRelease(entries: readonly NewsItem[]): Release[] {
  const releases = new Map<string, NewsItem[]>();
  for (const e of entries) releases.set(e.since, [...(releases.get(e.since) ?? []), e]);
  return [...releases]
    .sort(([a], [b]) => newer(a, b))
    .map(([version, list]) => ({
      version,
      entries: [...list.filter((e) => e.applies), ...list.filter((e) => !e.applies)],
    }));
}

/** The menu's few lines: the newest that apply to this owner, else the newest. */
export function latest(entries: readonly NewsItem[], n = 3): NewsItem[] {
  const all = byRelease(entries).flatMap((r) => r.entries);
  const mine = all.filter((e) => e.applies);
  return (mine.length ? mine : all).slice(0, n);
}

export const words = (w: { en: string; es: string }, lang: string): string => (lang === "es" ? w.es : w.en);

/**
 * Whether an entry carries its dot: it applies to the owner and they have not opened it. Nothing opened on this device
 * yet: the newest release's entries count as unread, older ones as read.
 */
export function isUnread(entry: NewsItem, entries: readonly NewsItem[], read: readonly string[] | null): boolean {
  if (!entry.applies) return false;
  if (read) return !read.includes(entry.id);
  return entry.since === byRelease(entries)[0]?.version;
}

/** Whether the Help button shows its dot: an entry is still unread. */
export const hasFresh = (entries: readonly NewsItem[], read: readonly string[] | null): boolean =>
  entries.some((e) => isUnread(e, entries, read));

/** What is read once `ids` are opened: what was read before (the older releases, the first time) and these. */
export function withRead(
  entries: readonly NewsItem[],
  read: readonly string[] | null,
  ids: readonly string[],
): string[] {
  const before = read ?? entries.filter((e) => !isUnread(e, entries, null)).map((e) => e.id);
  return [...new Set([...before, ...ids])];
}
