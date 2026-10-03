// What the bot adapters (Telegram, Discord, Slack) share: waiting that a stop cuts short, and which network failures
// mean a request never left this machine.

/** Failures before a request leaves this machine: the message surely did not go out. */
export const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

/** The network error's code behind a failed fetch, if any. */
export const causeCode = (err: unknown): string | undefined =>
  (err as { cause?: { code?: string } } | undefined)?.cause?.code;

/** Waits, unless the adapter is stopped first. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Long text in parts of at most `max` characters, cut at a line or a space when there is one. */
export function splitText(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf("\n", max), rest.lastIndexOf(" ", max));
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
