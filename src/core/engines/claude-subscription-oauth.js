// APX-owned Claude Pro/Max OAuth (PKCE), Hermes/Claude Code client shape.
//
// Tokens: ~/.apx/auth/claude-subscription.json — separate from Claude Code CLI.
// Caveat (same as Hermes): Max + extra usage credits. Pro alone is not enough.
// Inference: Authorization Bearer + claude-code User-Agent + oauth betas.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { APX_HOME, apxHome } from "#core/config/paths.js";

export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
export const CLAUDE_OAUTH_SCOPES = "org:create_api_key user:profile user:inference";
export const CLAUDE_OAUTH_TOKEN_URLS = [
  "https://platform.claude.com/v1/oauth/token",
  "https://console.anthropic.com/v1/oauth/token",
];
/** Token endpoint rejects claude-code/* and Mozilla UAs — bare axios like the CLI. */
export const CLAUDE_OAUTH_TOKEN_UA = "axios/1.7.9";
export const CLAUDE_INFERENCE_UA = "claude-code/2.1.32 (external, cli)";
export const CLAUDE_OAUTH_BETAS = "claude-code-20250219,oauth-2025-04-20";
export const CLAUDE_ACCESS_REFRESH_SKEW_MS = 120_000;

export function claudeSubscriptionAuthPath() {
  apxHome();
  return path.join(APX_HOME, "auth", "claude-subscription.json");
}

function ensureAuthDir() {
  const dir = path.dirname(claudeSubscriptionAuthPath());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function expiresAtMsFromResult(result) {
  const sec = Number(result?.expires_in);
  const ttl = Number.isFinite(sec) && sec > 0 ? sec : 3600;
  return Date.now() + ttl * 1000;
}

/** @returns {null | { accessToken: string, refreshToken: string, expiresAt: number, source?: string, path: string }} */
export function readApxClaudeAuth() {
  const p = claudeSubscriptionAuthPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const access = String(raw.accessToken || raw.tokens?.access_token || "").trim();
    const refresh = String(raw.refreshToken || raw.tokens?.refresh_token || "").trim();
    if (!access || !refresh) return null;
    const expiresAt = Number(raw.expiresAt || raw.expires_at_ms || 0) || 0;
    return {
      accessToken: access,
      refreshToken: refresh,
      expiresAt,
      source: raw.source || "apx",
      path: p,
    };
  } catch {
    return null;
  }
}

export function writeApxClaudeAuth({ accessToken, refreshToken, expiresAt, source = "pkce" }) {
  ensureAuthDir();
  const p = claudeSubscriptionAuthPath();
  const body = {
    accessToken,
    refreshToken,
    expiresAt: expiresAt || Date.now() + 3600_000,
    source,
    last_refresh: new Date().toISOString(),
  };
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, p);
  try { fs.chmodSync(p, 0o600); } catch { /* best-effort */ }
  return { ...body, path: p };
}

export function clearApxClaudeAuth() {
  const p = claudeSubscriptionAuthPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

async function postOauthToken(bodyObj, { timeoutMs = 20000 } = {}) {
  const body = JSON.stringify(bodyObj);
  let lastErr;
  for (const url of CLAUDE_OAUTH_TOKEN_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": CLAUDE_OAUTH_TOKEN_UA,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* keep */ }
      if (!res.ok) {
        const code = json?.error || `http_${res.status}`;
        const err = new Error(
          `claude-oauth: ${code}: ${json?.error_description || text.slice(0, 200)}`
        );
        err.code = String(code);
        err.relogin = res.status === 401 || res.status === 403
          || ["invalid_grant", "invalid_token"].includes(String(code));
        lastErr = err;
        if (err.relogin) break;
        continue;
      }
      if (!json?.access_token) {
        lastErr = new Error("claude-oauth: response missing access_token");
        continue;
      }
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("claude-oauth: token endpoint failed");
}

export async function refreshClaudeTokens(refreshToken) {
  if (!refreshToken) throw new Error("claude-oauth: missing refresh_token");
  const json = await postOauthToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLAUDE_OAUTH_CLIENT_ID,
  });
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: expiresAtMsFromResult(json),
  };
}

export async function resolveApxClaudeCreds({ forceRefresh = false } = {}) {
  const stored = readApxClaudeAuth();
  if (!stored) {
    const err = new Error(
      "claude-oauth: no APX Claude login. Run `apx auth claude login`."
    );
    err.relogin = true;
    throw err;
  }
  let access = stored.accessToken;
  let refresh = stored.refreshToken;
  let expiresAt = stored.expiresAt;
  const nearExpiry = !expiresAt || expiresAt <= Date.now() + CLAUDE_ACCESS_REFRESH_SKEW_MS;
  if (forceRefresh || nearExpiry) {
    const next = await refreshClaudeTokens(refresh);
    const written = writeApxClaudeAuth({
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: next.expiresAt,
      source: stored.source || "pkce",
    });
    access = written.accessToken;
    refresh = written.refreshToken;
    expiresAt = written.expiresAt;
  }
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at_ms: expiresAt,
    auth_path: claudeSubscriptionAuthPath(),
    source: "apx",
  };
}

/** Headers for api.anthropic.com Messages with subscription OAuth. */
export function claudeSubscriptionHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-beta": CLAUDE_OAUTH_BETAS,
    "user-agent": CLAUDE_INFERENCE_UA,
  };
}

function buildAuthorizeUrl(challenge, state) {
  const q = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
    scope: CLAUDE_OAUTH_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `https://claude.ai/oauth/authorize?${q.toString()}`;
}

/** In-memory PKCE sessions for web login (session_id → verifier/state). */
const pendingClaudeSessions = new Map();
const CLAUDE_SESSION_TTL_MS = 15 * 60 * 1000;

function pruneClaudeSessions() {
  const now = Date.now();
  for (const [id, s] of pendingClaudeSessions) {
    if (now - s.created_at > CLAUDE_SESSION_TTL_MS) pendingClaudeSessions.delete(id);
  }
}

/**
 * Start PKCE without stdin — for web/API.
 * @returns {{ session_id: string, auth_url: string }}
 */
export function startClaudePkceLogin() {
  pruneClaudeSessions();
  const { verifier, challenge } = pkcePair();
  const state = crypto.randomBytes(32).toString("base64url");
  const session_id = crypto.randomBytes(16).toString("hex");
  pendingClaudeSessions.set(session_id, {
    verifier,
    state,
    created_at: Date.now(),
  });
  return {
    session_id,
    auth_url: buildAuthorizeUrl(challenge, state),
  };
}

/**
 * Finish PKCE with pasted `code` or `code#state`.
 * @returns {Promise<{ path: string }>}
 */
export async function completeClaudePkceLogin({ session_id, code: pasted } = {}) {
  pruneClaudeSessions();
  const session = pendingClaudeSessions.get(String(session_id || ""));
  if (!session) throw new Error("claude-oauth: session expired — start login again");
  const raw = String(pasted || "").trim();
  if (!raw) throw new Error("claude-oauth: no code entered");
  const [code, receivedState = ""] = raw.split("#");
  if (receivedState && receivedState !== session.state) {
    throw new Error("claude-oauth: state mismatch (CSRF) — run login again");
  }
  const json = await postOauthToken({
    grant_type: "authorization_code",
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    code,
    state: receivedState || session.state,
    redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
    code_verifier: session.verifier,
  });
  pendingClaudeSessions.delete(String(session_id));
  const written = writeApxClaudeAuth({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: expiresAtMsFromResult(json),
    source: "pkce",
  });
  return { path: written.path };
}

function askLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(String(ans || "").trim());
    });
  });
}

/**
 * Interactive PKCE login. User pastes `code#state` from the browser page.
 * @returns {Promise<{ path: string }>}
 */
export async function runClaudePkceLoginInteractive({ openBrowser = true } = {}) {
  const started = startClaudePkceLogin();
  console.log("");
  console.log("Authorize APX with Claude Pro/Max (tokens → ~/.apx — Claude CLI untouched).");
  console.log("");
  console.log("  Needs: Claude Max + extra usage credits (Pro alone is not enough).");
  console.log("");
  console.log("  1. Open this URL:");
  console.log(`     ${started.auth_url}`);
  console.log("");
  console.log("  2. After approve, paste the code shown (often code#state).");
  console.log("");
  if (openBrowser) {
    try {
      const open = (await import("open")).default;
      await open(started.auth_url);
      console.log("  (Browser opened)");
    } catch { /* optional */ }
  }

  const pasted = await askLine("Authorization code: ");
  return completeClaudePkceLogin({ session_id: started.session_id, code: pasted });
}
