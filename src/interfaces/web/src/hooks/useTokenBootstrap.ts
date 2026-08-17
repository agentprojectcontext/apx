import { useCallback, useEffect, useState } from "react";
import { getToken, setToken, http, HttpError, Pair } from "../lib/api";
import { STORAGE } from "../constants";
import { deviceLabel } from "../lib/device";

type Status =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "unpaired" }
  | { status: "error"; reason: string };

export type AuthState = Status & { reload: () => void };

/**
 * Token acquisition order:
 *   1. URL fragment   — `#token=<hex>`. Used when sharing the panel through a
 *      Cloudflare/ngrok tunnel: the fragment is never sent to the server, the
 *      operator pastes it once via the share link, JS reads it, then strips
 *      it from the URL so it's not in browser history.
 *   2. /admin/web-token — same-origin loopback endpoint. Works when the panel
 *      is opened directly on the host running the daemon (localhost:7430).
 *   3. localStorage   — a token stashed from a previous pairing/session.
 *
 * Outcomes:
 *   - daemon unreachable          → "error"  (clear "daemon down" splash)
 *   - reachable, valid token      → "ok"
 *   - reachable, no/stale token   → "unpaired" (show the pairing screen)
 *
 * The loopback endpoint refuses non-loopback and tunneled requests, so when
 * the panel is opened over the LAN or a tunnel there's no auto-token: the
 * operator must pair the browser (see PairingScreen).
 */
// One in-flight confirm per pairing id. The daemon burns the nonce on first
// use, so a duplicate call would answer 409 and undo an otherwise successful
// pairing.
const inFlightConfirm = new Map<string, ReturnType<typeof Pair.confirm>>();

function confirmOnce(pairingId: string) {
  const existing = inFlightConfirm.get(pairingId);
  if (existing) return existing;
  const p = Pair.confirm({ pairing_id: pairingId, label: deviceLabel(), kind: "web" });
  inFlightConfirm.set(pairingId, p);
  return p;
}

export function useTokenBootstrap(): AuthState {
  const [state, setState] = useState<Status>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Is the daemon even up?
      try {
        const probe = await fetch("/health");
        if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
      } catch (e) {
        if (!cancelled) setState({ status: "error", reason: String(e) });
        return;
      }

      // 2a. Scan-to-login: `#pair=<pairing_id>` from a QR. Confirm the nonce
      // to mint this browser's own token, then drop the fragment.
      const hash = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(hash);
      const pairId = params.get("pair");
      if (pairId) {
        try {
          // The nonce is ONE-SHOT on the daemon, and StrictMode runs this
          // effect twice in development — so the second run must reuse the
          // first call's promise instead of confirming again and getting
          // "already confirmed" back. Keyed by id, module-level, because the
          // component remounts between the two runs.
          const res = await confirmOnce(pairId);
          setToken(res.token);
          try { localStorage.setItem(STORAGE.token, res.token); } catch { /* quota */ }
          // Only NOW drop the fragment. Stripping it first meant a failed
          // confirm left the device with no way to retry: the nonce was spent
          // and the link that carried it was already gone from the URL.
          history.replaceState(null, "", window.location.pathname + window.location.search);
          setState({ status: "ok" });
          return;
        } catch {
          // Genuinely expired or already spent. Keep the fragment so a reload
          // reports the same thing instead of silently showing a blank
          // pairing screen, and fall through to the manual path.
        }
      }

      // 2b. URL fragment token (tunnel share link).
      const fragmentToken = params.get("token");
      if (fragmentToken) {
        setToken(fragmentToken);
        try { localStorage.setItem(STORAGE.token, fragmentToken); } catch { /* quota */ }
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } else {
        try {
          const cached = localStorage.getItem(STORAGE.token);
          if (cached) setToken(cached);
        } catch { /* ignore */ }
      }

      // 3. Loopback endpoint — only succeeds on local same-origin requests.
      try {
        const t = await fetch("/admin/web-token");
        if (t.ok) {
          const body = await t.json();
          if (body?.token) {
            setToken(body.token);
            try { localStorage.setItem(STORAGE.token, body.token); } catch { /* quota */ }
          }
        }
      } catch { /* ignore — loopback-only or tunneled */ }

      // 4. Decide. No token at all → needs pairing.
      if (!getToken()) {
        if (!cancelled) setState({ status: "unpaired" });
        return;
      }

      // 5. Validate the token with one cheap authenticated call.
      try {
        await http.get("/projects");
        if (!cancelled) setState({ status: "ok" });
      } catch (e) {
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
          // Stale/invalid token — drop it and ask to pair.
          setToken(null);
          try { localStorage.removeItem(STORAGE.token); } catch { /* ignore */ }
          if (!cancelled) setState({ status: "unpaired" });
        } else {
          if (!cancelled) setState({ status: "error", reason: String(e) });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  return { ...state, reload };
}
