// Google OAuth2 for user-delegated integrations (Calendar today).
//
// Why this exists — and why it replaced the service account:
//
// A service account acts as ITSELF. It can read a shared calendar and create
// events on it, but Google blocks it from inviting other people or minting a
// Meet link unless the whole account lives inside a Google Workspace domain
// with Domain-Wide Delegation — a thing a personal @gmail.com simply does not
// have. So "agendá una reunión con Carlos y mandale el Meet" was impossible.
//
// User OAuth acts AS YOU. You consent once in the browser, Google hands back a
// refresh token, and from then on APX creates events, sends invitations, and
// creates Meet links on your own calendar — because it is you doing it. The
// price is a one-time OAuth client (client_id + secret) created in Google Cloud
// Console, and that is the only console step left: no key file, no manual
// calendar sharing, no Workspace.
//
// The flow: build a consent URL → the browser round-trips → Google redirects to
// our callback with a `code` → we exchange it for a refresh token → we cache
// short-lived access tokens in memory and refresh them as needed. ~1 file of
// node:crypto + fetch, no Google SDK.
import crypto from "node:crypto";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

// The path Google redirects the browser back to. Kept scope/project-agnostic —
// everything the callback needs travels in the signed `state`, so ONE redirect
// URI is registered in the console and never changes. Mounted under /api by the
// daemon (see api/prefix.js), so the full URL is `<origin>/api/integrations/oauth/callback`.
export const CALLBACK_PATH = "/api/integrations/oauth/callback";

/** The redirect URI to register in the console and to send on every exchange. */
export function callbackUrl(origin) {
  return `${String(origin || "").replace(/\/$/, "")}${CALLBACK_PATH}`;
}

// ─── state: signed, so the unauthenticated callback can't be forged ──────────
//
// The callback bypasses bearer auth (Google's browser redirect carries no
// token), so anyone could hit it. We defend it by signing the `state` we put in
// the consent URL with a per-process key: a callback whose state doesn't verify
// is rejected. The key is ephemeral on purpose — a daemon restart invalidates
// any consent link older than one boot, which is fine for a 10-minute flow.
const STATE_KEY = crypto.randomBytes(32);
const STATE_TTL_MS = 10 * 60_000;

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj) => b64url(JSON.stringify(obj));
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Sign a small state payload (slug, pid, scope, origin) into an opaque token. */
export function signState(payload) {
  const body = b64urlJson({ ...payload, exp: Date.now() + STATE_TTL_MS });
  const sig = b64url(crypto.createHmac("sha256", STATE_KEY).update(body).digest());
  return `${body}.${sig}`;
}

/** Verify + decode a state token, or return null if forged/expired/malformed. */
export function verifyState(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", STATE_KEY).update(body).digest());
  // Constant-time compare — the lengths match by construction (same HMAC).
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return null;
  return data;
}

// ─── consent URL ─────────────────────────────────────────────────────────────

/**
 * The URL to send the browser to. `access_type=offline` + `prompt=consent`
 * guarantee a refresh token comes back every time (Google omits it on repeat
 * consents otherwise, which would silently break reconnects).
 */
export function buildAuthUrl({ clientId, redirectUri, scope, state }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scope);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

// ─── token exchange + refresh ────────────────────────────────────────────────

async function tokenRequest(params, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Google rechazó el intercambio de token: ${detail}`);
  }
  return data;
}

/** First exchange: authorization code → { refresh_token, access_token, email }. */
export async function exchangeCode({ clientId, clientSecret, code, redirectUri }, opts = {}) {
  const data = await tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    },
    opts,
  );
  if (!data.refresh_token) {
    throw new Error(
      "Google no devolvió un refresh token. Revocá el acceso de APX en myaccount.google.com/permissions y volvé a conectar (el flujo fuerza el consentimiento).",
    );
  }
  return {
    refresh_token: data.refresh_token,
    access_token: data.access_token || null,
    expires_in: Number(data.expires_in) || 3600,
    email: emailFromIdToken(data.id_token),
  };
}

// Access tokens last an hour and cost a round-trip; cache in memory keyed by the
// refresh token, so several tool calls in one turn don't each re-mint one.
const accessCache = new Map();

export function clearAccessCache() {
  accessCache.clear();
}

/** A valid access token for a refresh token, minted or served from cache. */
export async function accessTokenFor({ clientId, clientSecret, refreshToken }, opts = {}) {
  const hit = accessCache.get(refreshToken);
  if (hit && hit.expires_at - 60_000 > Date.now()) return hit.access_token;
  const data = await tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    },
    opts,
  );
  if (!data.access_token) throw new Error("Google no devolvió un access token al refrescar.");
  accessCache.set(refreshToken, {
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  });
  return data.access_token;
}

/** Best-effort account email, decoded from the id_token payload (no verify). */
export function emailFromIdToken(idToken) {
  const seg = String(idToken || "").split(".")[1];
  if (!seg) return null;
  try {
    const claims = JSON.parse(fromB64url(seg).toString("utf8"));
    return claims.email || null;
  } catch {
    return null;
  }
}
