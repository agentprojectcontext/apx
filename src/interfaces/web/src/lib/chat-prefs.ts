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
