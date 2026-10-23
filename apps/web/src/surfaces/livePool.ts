import { useSyncExternalStore } from "react";
import { setAnyLive } from "./liveAny.ts";

// Pages kept running while hidden, in one overlay layer of the shell (moving an iframe in the DOM reloads it, so each
// stays put and is laid over whichever placeholder shows it): apps the owner opened, until closed, and pages that
// declare apx-live, for their keep time. See DECISIONS.md#d-119.

/** Live pages kept running at once; beyond it the one seen least recently is closed. */
export const LIVE_MAX = 3;
/** Apps the owner opened, kept running at once; the seventh closes the one seen least recently. */
export const OPEN_MAX = 6;

export type LiveFit = "content" | "fill";

/** The placeholder a live page is laid over, while one is mounted. */
export type LiveHost = { id: number; el: HTMLElement; fit: LiveFit; maxHeight: number };

export type LiveEntry = {
  surface: string;
  /** How long it runs after its last host went away (Infinity: until evicted). */
  keepMs: number;
  host: LiveHost | null;
  lastSeen: number;
  /** The frame's height as it reported it, for the placeholder to reserve. */
  height: number;
  /** An app the owner opened: it runs until closed (or evicted by a newer one), whatever its page declares. */
  open: boolean;
};

type Slot = Pick<LiveEntry, "surface" | "keepMs" | "lastSeen" | "open"> & { hosted: boolean };

/**
 * Whether `surface` may take a host in the pool: not while another placeholder holds it (that one shows it), and when
 * the pool is full only by closing the least recently seen page that no placeholder holds.
 */
export function admit(
  slots: readonly Slot[],
  surface: string,
  open = false,
): { ok: true; evict?: string } | { ok: false } {
  const own = slots.find((s) => s.surface === surface);
  if (own) return own.hosted ? { ok: false } : { ok: true };
  // Opened apps and live pages each have their own room, so one kind never closes the other.
  const kind = slots.filter((s) => s.open === open);
  if (kind.length < (open ? OPEN_MAX : LIVE_MAX)) return { ok: true };
  const idle = kind.filter((s) => !s.hosted).sort((a, b) => a.lastSeen - b.lastSeen)[0];
  return idle ? { ok: true, evict: idle.surface } : { ok: false };
}

/** Pages no placeholder holds whose keep time ran out; an opened app has none. */
export function expired(slots: readonly Slot[], now: number): string[] {
  return slots.filter((s) => !s.open && !s.hosted && now - s.lastSeen > s.keepMs).map((s) => s.surface);
}

const slotOf = (e: LiveEntry): Slot => ({
  surface: e.surface,
  keepMs: e.keepMs,
  lastSeen: e.lastSeen,
  open: e.open,
  hosted: e.host !== null,
});

let entries: readonly LiveEntry[] = [];
let nextHost = 1;
const subs = new Set<() => void>();

function set(next: readonly LiveEntry[]): void {
  entries = next;
  setAnyLive(next.length > 0);
  for (const f of subs) f();
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export const liveEntries = (): readonly LiveEntry[] => entries;

/** Lays the live page over `el`; undefined when the pool cannot (the caller shows the page itself). */
export function attachLive(
  surface: string,
  keepMs: number,
  host: Omit<LiveHost, "id">,
  now = Date.now(),
  open = false,
): number | undefined {
  const own0 = entries.find((e) => e.surface === surface);
  const verdict = admit(entries.map(slotOf), surface, own0?.open || open);
  if (!verdict.ok) return undefined;
  const id = nextHost++;
  const kept = entries.filter((e) => e.surface !== verdict.evict);
  const own = kept.find((e) => e.surface === surface);
  const entry: LiveEntry = own
    ? { ...own, keepMs, host: { ...host, id }, lastSeen: now, open: own.open || open }
    : { surface, keepMs, host: { ...host, id }, lastSeen: now, height: 120, open };
  // In place, never moved to the end: the layer renders entries in this order, and a moved iframe reloads.
  set(own ? kept.map((e) => (e.surface === surface ? entry : e)) : [...kept, entry]);
  return id;
}

/** The placeholder went away: the page keeps running, hidden, until its keep time ends or it is evicted. */
export function detachLive(surface: string, hostId: number, now = Date.now()): void {
  if (!entries.some((e) => e.surface === surface && e.host?.id === hostId)) return;
  set(entries.map((e) => (e.surface === surface ? { ...e, host: null, lastSeen: now } : e)));
}

export function setLiveHeight(surface: string, height: number): void {
  if (!entries.some((e) => e.surface === surface && e.height !== height)) return;
  set(entries.map((e) => (e.surface === surface ? { ...e, height } : e)));
}

/** Closes the pages whose keep time ran out. */
export function sweepLive(now = Date.now()): void {
  const gone = new Set(expired(entries.map(slotOf), now));
  if (gone.size) set(entries.filter((e) => !gone.has(e.surface)));
}

export function useLiveEntries(): readonly LiveEntry[] {
  return useSyncExternalStore(subscribe, liveEntries);
}

export function useLiveHeight(surface: string): number {
  return useSyncExternalStore(subscribe, () => entries.find((e) => e.surface === surface)?.height ?? 120);
}

/** Closes a live page at once (it stopped declaring apx-live, or it is gone). */
export function dropLive(surface: string): void {
  if (entries.some((e) => e.surface === surface)) set(entries.filter((e) => e.surface !== surface));
}

/** The apps the owner opened that are still running, oldest first. */
export function useRunningApps(): readonly string[] {
  const all = useLiveEntries();
  return all.filter((e) => e.open).map((e) => e.surface);
}
