import { useCallback, useEffect, useState } from "react";
import { apiUrl, recoverConnection } from "../lib/net";
import { getToken, setToken, setReauthorize, http, HttpError, Pair, Net } from "../lib/api";
import { loadEnginePresets } from "../components/settings/providers/typeStyles";
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

/**
 * Get a token the daemon currently accepts, for a page that already had one.
 *
 * The daemon mints a NEW master token on every boot, so every `apx restart`
 * invalidates whatever this tab is holding. The loopback endpoint is the answer
 * on the machine running the daemon; it refuses non-loopback and tunnelled
 * requests, so over the LAN or a tunnel there is nothing to hand back.
 *
 * THE TWO FAILURES ARE NOT THE SAME, which is the whole reason this returns a
 * shape instead of `string | null`. "The daemon did not answer" is what happens
 * for the second or two of every restart, and it is transient — reporting it as
 * "this browser needs to be paired" throws the reader onto a pairing screen,
 * with a code to type, because a daemon was rebooting. "The daemon answered and
 * would not give me one" is the real, permanent thing pairing exists for.
 */
type TokenAttempt =
  | { token: string }
  | { unreachable: true }   // nothing answered — restarting, or down
  | { refused: true };      // answered, but not from loopback

async function fetchLoopbackToken(): Promise<TokenAttempt> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/admin/web-token"));
  } catch {
    return { unreachable: true };
  }
  if (!res.ok) return { refused: true };
  try {
    const body = await res.json();
    const fresh = body?.token;
    if (!fresh || typeof fresh !== "string") return { refused: true };
    setToken(fresh);
    try { localStorage.setItem(STORAGE.token, fresh); } catch { /* quota */ }
    return { token: fresh };
  } catch {
    return { refused: true };
  }
}

export function useTokenBootstrap(): AuthState {
  const [state, setState] = useState<Status>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  // Teach the transport how to recover, for as long as this panel is mounted.
  // Deliberately NOT inside the bootstrap effect below: that one runs once and
  // is done, and the 401 it has to survive arrives hours later, the first time
  // the daemon is restarted under a tab somebody left open.
  useEffect(() => {
    setReauthorize(async () => {
      const got = await fetchLoopbackToken();
      if ("token" in got) return got.token;
      // Refused: there is no token to be had from here and there never will be
      // (LAN, tunnel). Say so, rather than letting every request fail silently
      // behind a panel that looks fine.
      if ("refused" in got) setState({ status: "unpaired" });
      // Unreachable: say NOTHING and change nothing. This is a daemon in the
      // middle of a restart, which is the exact situation this whole mechanism
      // exists for — the callers retry, and the panel must not flash a pairing
      // screen at somebody who just ran `apx restart`.
      return null;
    });
    return () => setReauthorize(null);
  }, []);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Is the daemon even up — at THIS address?
      //
      // An installed app launches at whatever URL it was installed from, and
      // that URL is a promise the network cannot always keep: off the Wi-Fi,
      // or with Tailscale down, it is simply gone. Before reporting the daemon
      // as unreachable, try the other addresses it told us about.
      try {
        const probe = await fetch(apiUrl("/api/health"));
        if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
      } catch (e) {
        const recovered = await recoverConnection();
        if (recovered === null) {
          if (!cancelled) setState({ status: "error", reason: String(e) });
          return;
        }
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
          void loadEnginePresets();
          void Net.endpoints().catch(() => {});
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
      //    Same call the 401 recovery makes; one implementation, so a token
      //    obtained at first paint and one obtained after a restart come from
      //    the same place and are stored the same way.
      await fetchLoopbackToken();

      // 4. Decide. No token at all → needs pairing.
      if (!getToken()) {
        if (!cancelled) setState({ status: "unpaired" });
        return;
      }

      // 5. Validate the token with one cheap authenticated call.
      try {
        await http.get("/api/projects");
        // Authenticated at last — now the shared model catalog can load.
        void loadEnginePresets();
        // And now the daemon's other addresses can be cached, which is what
        // makes the failover above possible the NEXT time this address dies.
        void Net.endpoints().catch(() => {});
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
