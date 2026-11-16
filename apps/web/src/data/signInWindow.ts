// A sign-in opened in a window of its own (OpenRouter's) and the page it returns to. The provider's pages cut the
// window's link to the panel that opened it, so the two talk through this browser's storage and a broadcast instead.
const MARK = "apx.signin.window";
const CHANNEL = "apx-signin";
/** How long a sign-in window started here can still come back as one. */
const MARK_MS = 15 * 60_000;

/** Says a sign-in window is about to open from here. */
export function markSignInWindow(): void {
  try {
    localStorage.setItem(MARK, String(Date.now()));
  } catch {}
}

/** Whether this page is the return of a sign-in window the panel opened minutes ago. */
export function isSignInWindow(): boolean {
  try {
    const at = Number(localStorage.getItem(MARK));
    return Number.isFinite(at) && at > 0 && Date.now() - at < MARK_MS;
  } catch {
    return false;
  }
}

/** The return page tells every open panel of this APX that the sign-in finished. */
export function tellSignInDone(id: string): void {
  try {
    localStorage.removeItem(MARK);
  } catch {}
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ id });
    ch.close();
  } catch {}
}

/** Runs `then` when a sign-in window says it finished; returns how to stop listening. */
export function onSignInDone(then: (id: string) => void): () => void {
  let ch: BroadcastChannel | undefined;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent<{ id?: unknown }>) => {
      if (typeof e.data?.id === "string") then(e.data.id);
    };
  } catch {}
  return () => ch?.close();
}
