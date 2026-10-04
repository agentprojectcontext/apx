// Push notices to a paired device whose app is closed: Expo's push service (an Expo push token) or a UnifiedPush /
// ntfy address (the body is the text, the title a header). Best effort: a failure is logged, never retried here.
import type { PushTarget } from "@apx/protocol";

export function createPush(opts: { expoUrl: string; onError?: (err: string) => void }) {
  return async function push(target: PushTarget, n: { title: string; body: string }): Promise<boolean> {
    try {
      const res =
        target.kind === "expo"
          ? await fetch(opts.expoUrl, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({ to: target.token, title: n.title, body: n.body, sound: "default" }),
              signal: AbortSignal.timeout(10_000),
            })
          : await fetch(target.endpoint, {
              method: "POST",
              headers: { "content-type": "text/plain; charset=utf-8", title: encodeURIComponent(n.title) },
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

export type Push = ReturnType<typeof createPush>;
