// What this DEVICE wants a chat to do, kept out of the global config for the
// same reason the per-channel view/notify choices are (lib/channels.ts): the
// phone and the desktop are used differently by the same person, and neither
// should be able to change the other's behaviour by accident.

const KEY = "apx.chat.queueOnSend";

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Send during a running turn: interrupt it, or wait behind it?
 *
 * The default is INTERRUPT, because that is what typing while an agent works
 * almost always means — "no, stop, do this instead" — and it is what Telegram
 * has always done (core/channels/telegram/dispatch.js aborts the running turn
 * when a new message arrives). Queueing was the web's behaviour only because
 * there was nothing to interrupt: no route passed a signal, so waiting was the
 * only thing the panel could offer.
 *
 * Queueing is still worth having on purpose — "finish that, then do this" —
 * which is why it stayed, as a choice rather than as the only option.
 */
export function queueOnSend(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode, blocked site data: fall back to the default rather than
    // making the composer throw.
    return false;
  }
}

export function setQueueOnSend(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* nothing to persist to; the session still honours the call below */
  }
  for (const fn of listeners) fn();
}

/** Subscribe to changes from anywhere in this tab. Returns an unsubscribe. */
export function onChatPrefsChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Transcript layout: tools visible, or pelado ─────────────────────────────
//
// Per CHAT, with a per-device fallback — and it lives here, beside the send
// mode, because it is the same kind of thing: what this device wants a chat to
// look like, never a setting that reaches anybody else. It used to live inside
// ChatTab, which meant the one other place that has to know the default (the
// "create group" checkbox, in ChatList) hardcoded its own copy of it — and the
// two drifted the moment the default changed.
//
// THE DEFAULT IS VISIBLE. The work an agent did is the part you cannot
// reconstruct from its answer, so hiding it until asked meant every new chat on
// every new device opened lying by omission about what had just run. Off is a
// choice you make, per chat, on the device you are reading from.
const SHOW_TOOLS_PREF = "apx.chat.showTools";
const SHOW_TOOLS_LAST = "apx.chat.showTools.last";

function readFlag(key: string): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return raw === "1" || raw === "true";
  } catch {
    return null;
  }
}

/** Storage key for one chat's layout. `chatKey` is `chatKeyToString(selection)`
 *  — the one spelling of what makes a chat itself, so the same conversation is
 *  the same row whether you opened it from the Inbox, a project or the phone. */
export function showToolsKey(pid: string | number, chatKey: string): string {
  return `${SHOW_TOOLS_PREF}.${pid}.${chatKey}`;
}

/** What this device shows in a chat nobody has set: the last flip of the header
 *  switch, else visible. */
export function showToolsDefault(): boolean {
  return readFlag(SHOW_TOOLS_LAST) ?? true;
}

/** Whether to show tools in this chat. */
export function showTools(key: string): boolean {
  return readFlag(key) ?? showToolsDefault();
}

/** Remember this chat's layout. `alsoDefault` moves the device fallback too —
 *  the header switch does (flipping it once should not have to be repeated in
 *  every conversation), the create-group checkbox does not: that one is a
 *  choice about that one room. */
export function setShowTools(key: string, on: boolean, opts?: { alsoDefault?: boolean }): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
    if (opts?.alsoDefault) localStorage.setItem(SHOW_TOOLS_LAST, on ? "1" : "0");
  } catch { /* quota / private mode: the session still honours the call */ }
}
