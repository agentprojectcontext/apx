// APX-owned ChatGPT/Codex OAuth (device-code flow).
//
// Tokens live under ~/.apx/auth/chatgpt-codex.json — a SEPARATE refresh-token
// family from the Codex CLI (~/.codex/auth.json). Refreshing here never logs
// the CLI out, and vice versa.
//
// Wire protocol matches what Codex CLI / Hermes use against auth.openai.com
// (public client_id app_EMoamEEZ73f0CkXaXp7hrann).

import fs from "node:fs";
import path from "node:path";
import { APX_HOME, apxHome } from "#core/config/paths.js";

export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
export const CODEX_OAUTH_TOKEN_URL = `${CODEX_OAUTH_ISSUER}/oauth/token`;
export const CODEX_OAUTH_USER_AGENT = "APX/chatgpt-codex";
export const CODEX_ACCESS_REFRESH_SKEW_S = 120;

/** @returns {string} */
export function chatgptCodexAuthPath() {
  apxHome();
  return path.join(APX_HOME, "auth", "chatgpt-codex.json");
}

function ensureAuthDir() {
  const dir = path.dirname(chatgptCodexAuthPath());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function decodeJwtPayload(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function openaiAuthClaims(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.["https://api.openai.com/auth"];
  return auth && typeof auth === "object" ? auth : {};
}

function accessTokenExpiring(accessToken, skewSeconds = CODEX_ACCESS_REFRESH_SKEW_S) {
  const exp = decodeJwtPayload(accessToken)?.exp;
  if (typeof exp !== "number") return false;
  return exp <= Math.floor(Date.now() / 1000) + Math.max(0, skewSeconds);
}

/** Read APX-owned store (null if missing). Does not refresh. */
export function readApxCodexAuth() {
  const p = chatgptCodexAuthPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const tokens = raw?.tokens;
    if (!tokens?.access_token || !tokens?.refresh_token) return null;
    return {
      tokens: {
        access_token: String(tokens.access_token),
        refresh_token: String(tokens.refresh_token),
        account_id: tokens.account_id ? String(tokens.account_id) : undefined,
        id_token: tokens.id_token ? String(tokens.id_token) : undefined,
      },
      last_refresh: raw.last_refresh || null,
      auth_mode: raw.auth_mode || "chatgpt",
      source: raw.source || "apx",
      path: p,
    };
  } catch {
    return null;
  }
}

/** Persist tokens atomically (mode 0600). */
export function writeApxCodexAuth({
  access_token,
  refresh_token,
  account_id,
  id_token,
  source = "device-code",
}) {
  ensureAuthDir();
  const p = chatgptCodexAuthPath();
  const claims = openaiAuthClaims(access_token);
  const acct = account_id || claims.chatgpt_account_id || undefined;
  const body = {
    auth_mode: "chatgpt",
    source,
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token,
      refresh_token,
      ...(acct ? { account_id: acct } : {}),
      ...(id_token ? { id_token } : {}),
    },
  };
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, p);
  try { fs.chmodSync(p, 0o600); } catch { /* best-effort */ }
  return { ...body, path: p };
}

export function clearApxCodexAuth() {
  const p = chatgptCodexAuthPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** Refresh against OpenAI; returns new token pair. Does not write. */
export async function refreshCodexTokens(refreshToken, { timeoutMs = 20000 } = {}) {
  if (!refreshToken) throw new Error("codex-oauth: missing refresh_token");
  const res = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": CODEX_OAUTH_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep */ }
  if (res.status === 429) {
    const err = new Error("codex-oauth: rate limited refreshing token (HTTP 429)");
    err.code = "codex_rate_limited";
    throw err;
  }
  if (!res.ok) {
    const code = json?.error || `http_${res.status}`;
    const err = new Error(
      `codex-oauth: refresh failed (${code}): ${json?.error_description || text.slice(0, 200)}`
    );
    err.code = String(code);
    err.relogin = res.status === 401 || res.status === 403
      || ["invalid_grant", "invalid_token", "refresh_token_reused"].includes(String(code));
    throw err;
  }
  if (!json?.access_token) throw new Error("codex-oauth: refresh response missing access_token");
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || refreshToken,
    id_token: json.id_token,
  };
}

/**
 * Ensure a usable access token from the APX store, refreshing + rewriting when
 * near expiry. Throws with .relogin=true when the user must run login again.
 */
export async function resolveApxCodexCreds({ forceRefresh = false } = {}) {
  const stored = readApxCodexAuth();
  if (!stored) {
    const err = new Error(
      "codex-oauth: no APX ChatGPT/Codex login. Run `apx auth chatgpt-codex login`."
    );
    err.relogin = true;
    throw err;
  }
  let access = stored.tokens.access_token;
  let refresh = stored.tokens.refresh_token;
  if (forceRefresh || accessTokenExpiring(access)) {
    const next = await refreshCodexTokens(refresh);
    const written = writeApxCodexAuth({
      access_token: next.access_token,
      refresh_token: next.refresh_token,
      id_token: next.id_token || stored.tokens.id_token,
      account_id: stored.tokens.account_id,
      source: stored.source || "device-code",
    });
    access = written.tokens.access_token;
    refresh = written.tokens.refresh_token;
  }
  const claims = openaiAuthClaims(access);
  const accountId = String(claims.chatgpt_account_id || stored.tokens.account_id || "").trim();
  if (!accountId) {
    throw new Error("codex-oauth: access token has no ChatGPT account id — re-login.");
  }
  const residency = String(
    claims.chatgpt_data_residency || claims.chatgpt_compute_residency || ""
  ).trim();
  const exp = decodeJwtPayload(access)?.exp;
  return {
    access_token: access,
    account_id: accountId,
    residency: residency || undefined,
    auth_path: chatgptCodexAuthPath(),
    expires_at: typeof exp === "number" ? exp : undefined,
    source: "apx",
  };
}

// ── Device-code login ────────────────────────────────────────────────────────

async function postJson(url, body, { timeoutMs = 15000 } = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": CODEX_OAUTH_USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep */ }
  return { status: res.status, json, text, headers: res.headers };
}

/** Step 1 — request a user code. */
export async function startCodexDeviceLogin() {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    last = await postJson(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
      client_id: CODEX_OAUTH_CLIENT_ID,
    });
    if (last.status !== 429) break;
    if (attempt < 4) {
      const ra = Number(last.headers.get("retry-after")) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(Math.max(1, ra), 60) * 1000));
    }
  }
  if (last.status === 429) throw new Error("codex-oauth: OpenAI rate-limited device login (429)");
  if (last.status !== 200) {
    throw new Error(`codex-oauth: device code request failed HTTP ${last.status}: ${last.text.slice(0, 200)}`);
  }
  const userCode = last.json?.user_code;
  const deviceAuthId = last.json?.device_auth_id;
  if (!userCode || !deviceAuthId) throw new Error("codex-oauth: incomplete device code response");
  return {
    user_code: userCode,
    device_auth_id: deviceAuthId,
    interval_s: Math.max(3, Number(last.json?.interval) || 5),
    verification_url: `${CODEX_OAUTH_ISSUER}/codex/device`,
  };
}

/**
 * One poll of the device-auth token endpoint.
 * @returns {{ status: "pending" } | { status: "ready", authorization_code: string, code_verifier: string }}
 */
export async function pollCodexDeviceLoginOnce({ device_auth_id, user_code } = {}) {
  if (!device_auth_id || !user_code) throw new Error("codex-oauth: device_auth_id and user_code required");
  const poll = await postJson(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`, {
    device_auth_id,
    user_code,
  });
  if (poll.status === 200) {
    const authorization_code = poll.json?.authorization_code;
    const code_verifier = poll.json?.code_verifier;
    if (!authorization_code || !code_verifier) {
      throw new Error("codex-oauth: device auth missing authorization_code/code_verifier");
    }
    return { status: "ready", authorization_code, code_verifier };
  }
  if (poll.status === 403 || poll.status === 404) return { status: "pending" };
  throw new Error(`codex-oauth: poll failed HTTP ${poll.status}: ${poll.text.slice(0, 200)}`);
}

/** Exchange device authorization_code → tokens and write APX store. */
export async function exchangeCodexDeviceCode({ authorization_code, code_verifier } = {}) {
  if (!authorization_code || !code_verifier) {
    throw new Error("codex-oauth: authorization_code and code_verifier required");
  }
  const tokenRes = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": CODEX_OAUTH_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorization_code,
      redirect_uri: `${CODEX_OAUTH_ISSUER}/deviceauth/callback`,
      client_id: CODEX_OAUTH_CLIENT_ID,
      code_verifier,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const tokenText = await tokenRes.text();
  let tokens;
  try { tokens = JSON.parse(tokenText); } catch {
    throw new Error(`codex-oauth: token exchange not JSON: ${tokenText.slice(0, 200)}`);
  }
  if (!tokenRes.ok || !tokens.access_token) {
    throw new Error(`codex-oauth: token exchange failed HTTP ${tokenRes.status}: ${tokenText.slice(0, 200)}`);
  }
  const written = writeApxCodexAuth({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    source: "device-code",
  });
  return {
    path: written.path,
    account_id: written.tokens.account_id,
  };
}

/**
 * Poll until the user finishes sign-in, exchange code → tokens, write APX store.
 * @returns {Promise<{ path: string, account_id?: string }>}
 */
export async function completeCodexDeviceLogin({
  device_auth_id,
  user_code,
  interval_s = 5,
  timeout_s = 15 * 60,
  onWaiting,
} = {}) {
  if (!device_auth_id || !user_code) throw new Error("codex-oauth: device_auth_id and user_code required");
  const deadline = Date.now() + timeout_s * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval_s * 1000));
    if (typeof onWaiting === "function") onWaiting();
    const step = await pollCodexDeviceLoginOnce({ device_auth_id, user_code });
    if (step.status === "ready") {
      return exchangeCodexDeviceCode({
        authorization_code: step.authorization_code,
        code_verifier: step.code_verifier,
      });
    }
  }
  throw new Error("codex-oauth: login timed out — run again");
}

/** Interactive CLI helper: print URL+code, poll, save. */
export async function runCodexDeviceLoginInteractive({ openBrowser = true } = {}) {
  console.log("");
  console.log("Before device login — required once per ChatGPT account:");
  console.log("  1. Open https://chatgpt.com/#settings/Security");
  console.log("  2. Enable «Device code authorization for Codex»");
  console.log("  3. Come back here (without that toggle, Continue stays disabled).");
  console.log("");
  const started = await startCodexDeviceLogin();
  console.log("To continue, follow these steps:");
  console.log("");
  console.log("  1. Open this URL in your browser:");
  console.log(`     ${started.verification_url}`);
  console.log("");
  console.log("  2. Enter this code:");
  console.log(`     ${started.user_code}`);
  console.log("");
  console.log("Waiting for sign-in... (Ctrl+C to cancel)");
  if (openBrowser) {
    try {
      const open = (await import("open")).default;
      await open(started.verification_url);
    } catch { /* optional */ }
  }
  const done = await completeCodexDeviceLogin({
    device_auth_id: started.device_auth_id,
    user_code: started.user_code,
    interval_s: started.interval_s,
  });
  return done;
}

export { accessTokenExpiring, openaiAuthClaims, decodeJwtPayload };
