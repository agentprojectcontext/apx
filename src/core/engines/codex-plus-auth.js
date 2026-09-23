// Resolve ChatGPT/Codex credentials for the codex-plus engine.
//
// Priority:
//   1. APX-owned OAuth store (~/.apx/auth/chatgpt-codex.json) — refresh OK
//   2. Optional borrow of Codex CLI (~/.codex/auth.json) — READ ONLY, no refresh
//
// Prefer `apx auth chatgpt-codex login` so the CLI and APX never share a
// refresh-token family.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decodeJwtPayload,
  openaiAuthClaims,
  readApxCodexAuth,
  resolveApxCodexCreds,
  chatgptCodexAuthPath,
} from "./codex-plus-oauth.js";

export const CODEX_PLUS_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CODEX_AUTH_PATH_DEFAULT = path.join(os.homedir(), ".codex", "auth.json");
export const CODEX_MODELS_CACHE_DEFAULT = path.join(os.homedir(), ".codex", "models_cache.json");

/**
 * Resolve where to read Codex CLI auth from (fallback only).
 * Config override: engines.chatgpt-codex.auth_path / engines.codex-plus.auth_path
 */
export function resolveCodexAuthPath(config = {}) {
  if (config.auth_path) return path.resolve(String(config.auth_path));
  if (process.env.CODEX_HOME) return path.join(process.env.CODEX_HOME, "auth.json");
  return CODEX_AUTH_PATH_DEFAULT;
}

function credsFromCliFile(authPath) {
  if (!fs.existsSync(authPath)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch {
    return null;
  }
  const tokens = raw?.tokens;
  const access = String(tokens?.access_token || "").trim();
  if (!access) return null;
  const claims = openaiAuthClaims(access);
  const accountId = String(claims.chatgpt_account_id || tokens.account_id || "").trim();
  if (!accountId) return null;
  const payload = decodeJwtPayload(access);
  const exp = typeof payload?.exp === "number" ? payload.exp : null;
  if (exp != null && exp <= Math.floor(Date.now() / 1000) + 30) return null; // expired — don't use
  const residency = String(
    claims.chatgpt_data_residency || claims.chatgpt_compute_residency || ""
  ).trim();
  return {
    access_token: access,
    account_id: accountId,
    residency: residency || undefined,
    auth_path: authPath,
    expires_at: exp || undefined,
    source: "cli-borrow",
  };
}

/**
 * Load usable ChatGPT/Codex subscription credentials.
 * Prefers APX-owned OAuth (with refresh). Falls back to a still-valid Codex
 * CLI access token when `config.borrow_cli !== false` and no APX login exists.
 */
export async function loadCodexPlusCreds(config = {}) {
  // 1) APX-owned store
  try {
    return await resolveApxCodexCreds();
  } catch (e) {
    if (!e.relogin && readApxCodexAuth()) throw e;
    // no APX login (or hard relogin) → maybe CLI borrow
  }

  if (config.borrow_cli === false) {
    throw new Error(
      `codex-plus: no APX login at ${chatgptCodexAuthPath()}. Run \`apx auth chatgpt-codex login\`.`
    );
  }

  const authPath = resolveCodexAuthPath(config);
  const cli = credsFromCliFile(authPath);
  if (cli) return cli;

  throw new Error(
    `codex-plus: no APX ChatGPT/Codex login and no valid Codex CLI token.\n` +
      `  → Preferred:  apx auth chatgpt-codex login\n` +
      `  → Temporary:  codex login  (borrowed read-only until APX login exists)`
  );
}

/** Sync wrapper for health() — checks APX store first, then CLI file presence. */
export function loadCodexPlusCredsSync(config = {}) {
  const apx = readApxCodexAuth();
  if (apx?.tokens?.access_token) {
    const access = apx.tokens.access_token;
    const claims = openaiAuthClaims(access);
    const accountId = String(claims.chatgpt_account_id || apx.tokens.account_id || "").trim();
    const exp = decodeJwtPayload(access)?.exp;
    const residency = String(
      claims.chatgpt_data_residency || claims.chatgpt_compute_residency || ""
    ).trim();
    return {
      access_token: access,
      account_id: accountId || "pending-refresh",
      residency: residency || undefined,
      auth_path: chatgptCodexAuthPath(),
      expires_at: typeof exp === "number" ? exp : undefined,
      source: "apx",
    };
  }
  if (config.borrow_cli === false) {
    throw new Error(`codex-plus: no APX login — run \`apx auth chatgpt-codex login\``);
  }
  const cli = credsFromCliFile(resolveCodexAuthPath(config));
  if (cli) return cli;
  throw new Error(`codex-plus: no login — run \`apx auth chatgpt-codex login\``);
}

/** HTTP headers the Codex ChatGPT backend expects. */
export function codexPlusHeaders(creds, { userAgent = "APX/codex-plus" } = {}) {
  const headers = {
    authorization: `Bearer ${creds.access_token}`,
    "content-type": "application/json",
    accept: "text/event-stream",
    "user-agent": userAgent,
    originator: "apx",
    "ChatGPT-Account-ID": creds.account_id,
  };
  if (creds.residency) {
    headers["x-openai-internal-codex-residency"] = creds.residency;
  }
  return headers;
}

/** Offline model list from Codex CLI cache, if present. */
export function readCodexModelsCache(config = {}) {
  const p = config.models_cache_path
    ? path.resolve(String(config.models_cache_path))
    : process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, "models_cache.json")
      : CODEX_MODELS_CACHE_DEFAULT;
  try {
    if (!fs.existsSync(p)) return [];
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const list = Array.isArray(j.models) ? j.models : [];
    return list
      .map((m) => (typeof m === "string" ? m : m?.slug || m?.id || m?.name))
      .filter(Boolean);
  } catch {
    return [];
  }
}
