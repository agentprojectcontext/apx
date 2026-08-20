// Who may open a WebSocket on this daemon.
//
// Every WS channel here is gated the same way and for the same reason: the
// daemon binds 0.0.0.0 when the panel is reachable from the LAN or a tailnet,
// so "can reach the port" is not "may open a channel". The upgrade request must
// carry a token the store already knows — the master token or a paired client's
// — exactly like the HTTP routes do. See QA BUG-WS-AUTH.
//
// One home for the check (rule 8): it started inside desktop-ws.js, which was
// fine while the desktop was the only channel. It now guards the terminal and
// the live event feed too, and a per-channel copy is how one of them ends up
// with a weaker rule than the others.

/** Extract the bearer token from an upgrade request (header first, ?token= fallback).
 *  Browsers cannot set headers on a WebSocket handshake, hence the query fallback. */
export function extractWsToken(req) {
  const auth = (req && req.headers && req.headers["authorization"]) || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  try {
    return new URL((req && req.url) || "", "http://localhost").searchParams.get("token") || "";
  } catch { return ""; }
}

/** True iff the upgrade request carries a token the store recognizes. */
export function isWsUpgradeAuthorized(req, tokenStore) {
  if (!tokenStore || typeof tokenStore.has !== "function") return false;
  return tokenStore.has(extractWsToken(req));
}
