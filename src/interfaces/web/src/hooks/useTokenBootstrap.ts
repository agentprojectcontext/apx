import { useEffect, useState } from "react";
import { setToken } from "../lib/api";

type AuthStatus =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "error"; reason: string };

/**
 * Daemon-side localhost-only endpoint `/api/web-token` returns the bearer
 * token APX uses today. Until that exists, we fall back to /health (which
 * doesn't need a token) to confirm the daemon is up, and let the user paste
 * a token via DevTools / future settings screen for the calls that require
 * it. This keeps the boot path independent of any pairing flow.
 */
export function useTokenBootstrap(): AuthStatus {
  const [state, setState] = useState<AuthStatus>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const probe = await fetch("/health");
        if (!probe.ok) throw new Error(`HTTP ${probe.status}`);

        // Best-effort: try to read a localhost-only token endpoint. If the
        // daemon exposes it (same-origin from /admin/...) we use it; if not,
        // we proceed unauthenticated and let the UI surface 401s on the
        // first authed call.
        try {
          const t = await fetch("/admin/web-token");
          if (t.ok) {
            const body = await t.json();
            if (body?.token) setToken(body.token);
          }
        } catch { /* ignore — no web-token endpoint yet */ }

        if (!cancelled) setState({ status: "ok" });
      } catch (e) {
        if (!cancelled) setState({ status: "error", reason: String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
