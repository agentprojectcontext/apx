import type { Message } from "../protocol";

/** A row of the transcript: a message, or the day it starts (shown once per day). */
export type TranscriptRow = { kind: "message"; message: Message } | { kind: "day"; key: string; at: string };

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Messages in order with a day row before the first message of each day. */
export function withDays(messages: Message[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let last = "";
  for (const message of messages) {
    const key = dayKey(message.created_at);
    if (key && key !== last) rows.push({ kind: "day", key: `day:${key}`, at: message.created_at });
    last = key || last;
    rows.push({ kind: "message", message });
  }
  return rows;
}

/** 1234 → "1.2k", 26000 → "26k", 1200000 → "1.2M". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1000) return `${trim(n / 1000)}k`;
  return String(n);
}
const trim = (n: number) => (n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ""));

/** How full the chat is: the last call's context over the model's window ("26k / 200k"). */
export function usageText(usage?: { context?: number; window?: number }): string | undefined {
  if (!usage?.context) return undefined;
  return usage.window ? `${compact(usage.context)} / ${compact(usage.window)}` : compact(usage.context);
}

/** A chat with no message yet says where to start, once it has loaded (a new chat has nothing to load). */
export function showsStartHint(chat: { rows: number; working: boolean; fresh: boolean; loaded: boolean }): boolean {
  return chat.rows === 0 && !chat.working && (chat.fresh || chat.loaded);
}
