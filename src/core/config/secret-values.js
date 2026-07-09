// Value-based secret masking (OpenHands-inspired). redact.js masks secrets by
// KEY (a config view knows "engines.openai.api_key" is secret); this module
// masks by VALUE: known secret strings are registered once (daemon boot +
// config hot-reload) and then scrubbed from ANY log text they leak into —
// free-text error messages, provider echoes, tool output captured in traces.
//
// Both layers stay on: key-based redaction catches secrets in structured meta
// even before registration; value-based masking catches them everywhere else.

import { SECRET_PATHS } from "./redact.js";

// Never register strings shorter than this — masking "abc" would shred every
// log line containing those three letters.
const MIN_SECRET_LENGTH = 6;

// Same key heuristic as SECRET_KEY_RE in core/logging.js — used to decide
// which MCP env/header entries hold secrets (env also carries harmless values
// like NODE_ENV whose masking would mangle unrelated log text).
const SECRET_ENTRY_KEY_RE = /(token|secret|password|api[_-]?key|authorization|credential)/i;

// Module-level registry. Additive on purpose: a hot-reload that removes a key
// keeps the old value masked — stale masking is harmless, a leak is not.
const registry = new Set();

function isRegistrable(value) {
  return typeof value === "string" && value.trim().length >= MIN_SECRET_LENGTH;
}

function getDotted(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Walk a config object and return every secret VALUE it holds: all
 * SECRET_PATHS entries, every telegram channel bot_token, and the legacy
 * root telegram.bot_token (pre-migration configs). Deduped; empty and
 * too-short strings dropped.
 */
export function collectSecretValues(cfg) {
  const out = new Set();
  try {
    if (!cfg || typeof cfg !== "object") return [];
    for (const dotted of SECRET_PATHS) {
      if (dotted.includes("*")) continue; // array paths handled below
      const val = getDotted(cfg, dotted);
      if (isRegistrable(val)) out.add(val);
    }
    const channels = cfg?.telegram?.channels;
    if (Array.isArray(channels)) {
      for (const ch of channels) {
        if (isRegistrable(ch?.bot_token)) out.add(ch.bot_token);
      }
    }
    if (isRegistrable(cfg?.telegram?.bot_token)) out.add(cfg.telegram.bot_token);
  } catch {
    // collection must never break the caller — return what we got so far
  }
  return Array.from(out);
}

/**
 * Extract secret values from an mcps.json shape ({ mcpServers: {name: {env,
 * headers}} }) — runtime/global MCP stores carry tokens in env vars and HTTP
 * headers. Only entries whose KEY looks secret are taken (see regex above).
 */
export function collectMcpSecretValues(mcpsJson) {
  const out = new Set();
  try {
    const servers = mcpsJson?.mcpServers;
    if (!servers || typeof servers !== "object") return [];
    for (const server of Object.values(servers)) {
      for (const bag of [server?.env, server?.headers]) {
        if (!bag || typeof bag !== "object") continue;
        for (const [key, val] of Object.entries(bag)) {
          if (SECRET_ENTRY_KEY_RE.test(key) && isRegistrable(val)) out.add(val);
        }
      }
    }
  } catch {
    // same never-throw contract as collectSecretValues
  }
  return Array.from(out);
}

/** Add values to the module-level registry. Invalid/short entries ignored. */
export function registerSecretValues(values) {
  if (!Array.isArray(values)) return;
  for (const v of values) {
    if (isRegistrable(v)) registry.add(v);
  }
}

export function getRegisteredSecretValues() {
  return Array.from(registry);
}

/** Test hook — empties the registry so cases don't bleed into each other. */
export function clearRegisteredSecretValues() {
  registry.clear();
}

// Visible marker in the same spirit as secretMarker() in redact.js (keep a
// short suffix so the user can tell WHICH secret leaked), but compact enough
// to live inline in a log line.
function maskedMarker(value) {
  return `***…${value.slice(-4)}`;
}

/**
 * Replace every registered secret value found in `text` with its marker.
 * Longest-first so a secret that contains another is masked whole instead of
 * being shredded by the shorter one. Non-string input is returned unchanged;
 * this function NEVER throws.
 */
export function maskSecretValues(text) {
  try {
    if (typeof text !== "string" || !text || registry.size === 0) return text;
    const values = Array.from(registry).sort((a, b) => b.length - a.length);
    let out = text;
    for (const value of values) {
      if (out.includes(value)) out = out.split(value).join(maskedMarker(value));
    }
    return out;
  } catch {
    return text;
  }
}
