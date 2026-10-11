// Push notices to a paired device whose app is closed: Expo's push service (an Expo push token) or a UnifiedPush /
// ntfy address (the body is the text; the title and the link that opens APX are headers). Best effort: a failure is
// logged, never retried here.
import type { PushTarget } from "@apx/protocol";

export function createPush(opts: { expoUrl: string; onError?: (err: string) => void }) {
  return async function push(
    target: PushTarget,
    n: { title: string; body: string; data?: Record<string, string> },
  ): Promise<boolean> {
    try {
      const res =
        target.kind === "expo"
          ? await fetch(opts.expoUrl, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({
                to: target.token,
                title: n.title,
                body: n.body,
                sound: "default",
                ...(n.data ? { data: n.data } : {}),
              }),
              signal: AbortSignal.timeout(10_000),
            })
          : await fetch(target.endpoint, {
              method: "POST",
              headers: {
                "content-type": "text/plain; charset=utf-8",
                title: encodedWord(n.title),
                click: openLink(n.data?.thread_id),
              },
              body: n.body,
              signal: AbortSignal.timeout(10_000),
            });
      if (!res.ok) opts.onError?.(`push answered HTTP ${res.status}`);
      return res.ok;
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : String(err));
      return false;
    }
  };
}

/** A header carries Latin-1 only; ntfy decodes an RFC 2047 encoded word, so the title shows as typed in any language. */
function encodedWord(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/** Tapping the notice in the ntfy app opens APX on the phone, on its chat when it has one. */
function openLink(threadId: string | undefined): string {
  return threadId ? `apx://open?t=${encodeURIComponent(threadId)}` : "apx://open";
}

export type Push = ReturnType<typeof createPush>;
