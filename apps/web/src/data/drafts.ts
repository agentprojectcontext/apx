// The owner's unsent words per chat (and per new chat not made yet), kept in this browser: moving to another chat,
// screen or window and back, or reloading, finds them where they were left.

const KEY = "apx.drafts";
/** The oldest drafts go first past this many chats, and any after a month untouched. */
const MAX = 200;
const MAX_AGE = 30 * 24 * 60 * 60_000;

type Entry = { text: string; at: number };

let drafts: Record<string, Entry> | undefined;
/** Chats whose draft changed here and is not written yet: only those are written, so other windows' stay. */
const dirty = new Set<string>();
let pending: ReturnType<typeof setTimeout> | undefined;

function read(): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<Entry>>;
    const fresh = Date.now() - MAX_AGE;
    for (const [id, e] of Object.entries(raw))
      if (typeof e?.text === "string" && e.text && typeof e.at === "number" && e.at > fresh)
        out[id] = { text: e.text, at: e.at };
  } catch {
    // Storage blocked or unreadable: drafts live in memory for this window.
  }
  return out;
}

const all = () => (drafts ??= read());
const listeners = new Set<() => void>();
export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(): void {
  pending = undefined;
  const mine = all();
  const merged = read();
  for (const id of dirty) {
    const e = mine[id];
    if (e) merged[id] = e;
    else delete merged[id];
  }
  dirty.clear();
  drafts = Object.fromEntries(
    Object.entries(merged)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX),
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    // Storage blocked or full: the draft still holds in memory.
  }
}

export function draftOf(chat: string): string {
  return all()[chat]?.text ?? "";
}

/** Keeps `text` as the chat's draft; empty clears it. Written to storage a moment later, and when the page goes. */
export function keepDraft(chat: string, text: string): void {
  const map = all();
  if ((map[chat]?.text ?? "") === text) return;
  if (text) map[chat] = { text, at: Date.now() };
  else delete map[chat];
  dirty.add(chat);
  pending ??= setTimeout(save, 300);
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (pending === undefined) return;
    clearTimeout(pending);
    save();
  });
  // Another window (the quick chat, a second tab) wrote: read again on next use.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && !dirty.size) {
      drafts = undefined;
      for (const listener of listeners) listener();
    }
  });
}
