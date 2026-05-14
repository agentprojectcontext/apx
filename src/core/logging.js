import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "./config.js";

export const LOG_DIR = path.join(APX_HOME, "logs");
export const ERROR_TRACE_PATH = path.join(LOG_DIR, "errors.jsonl");
// Unified daemon log. Every module (daemon, telegram, whisper, super-agent,
// tools, overlay) writes here with one consistent format so the user can
// follow the whole system from a single tail.
export const APX_LOG_PATH = path.join(LOG_DIR, "apx.log");

const SECRET_KEY_RE = /(token|secret|password|api[_-]?key|authorization|bot[_-]?token)/i;

function redact(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? "[redacted]" : redact(val, seen);
  }
  return out;
}

export function appendErrorTrace(record) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    ...redact(record),
  };
  fs.appendFileSync(ERROR_TRACE_PATH, JSON.stringify(entry) + "\n", "utf8");
}

export function previewText(text, max = 500) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

// ---------------------------------------------------------------------------
// Unified logger — writes to ~/.apx/logs/apx.log in the format:
//   [2026-05-13 22:35:01.234] [LEVEL ] [module] message {meta}
//
// `level` is INFO | WARN | ERROR (case-insensitive). Unknown levels fall back
// to INFO. `module` is a short tag (telegram, whisper, super-agent, daemon…).
// `meta` is optional; if present and non-empty, it's stringified at the end.
// Secrets in meta are redacted via the same SECRET_KEY_RE used by error traces.
//
// Returns the line that was written, so callers can also surface it elsewhere
// (e.g. process.stdout for the daemon's existing stdout log).
// ---------------------------------------------------------------------------

const LEVELS = new Set(["INFO", "WARN", "ERROR"]);

function fmtTs(d = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

export function formatLogLine(level, module, message, meta) {
  const lvl = LEVELS.has(String(level || "").toUpperCase())
    ? String(level).toUpperCase()
    : "INFO";
  const mod = String(module || "apx").slice(0, 24);
  const msg = String(message ?? "").replace(/\n/g, " ");
  let suffix = "";
  if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
    try { suffix = " " + JSON.stringify(redact(meta)); }
    catch { suffix = " {meta:unserializable}"; }
  }
  return `[${fmtTs()}] [${lvl.padEnd(5)}] [${mod}] ${msg}${suffix}`;
}

export function log(level, module, message, meta) {
  const line = formatLogLine(level, module, message, meta);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(APX_LOG_PATH, line + "\n", "utf8");
  } catch {
    // never throw from the logger — losing a log line must not crash the daemon
  }
  return line;
}

// Convenience helpers so callers don't repeat the level string everywhere.
export const logInfo  = (module, message, meta) => log("INFO",  module, message, meta);
export const logWarn  = (module, message, meta) => log("WARN",  module, message, meta);
export const logError = (module, message, meta) => log("ERROR", module, message, meta);

// Build a module-bound logger so plugins can do `const log = loggerFor("telegram")`
// and then `log.info("...")` without repeating the module tag.
export function loggerFor(module) {
  return {
    info:  (message, meta) => logInfo(module, message, meta),
    warn:  (message, meta) => logWarn(module, message, meta),
    error: (message, meta) => logError(module, message, meta),
    // Shorthand call form preserved for the daemon's old `log(msg)` callers:
    //   const log = loggerFor("daemon"); log("hello") // INFO
    // We wrap it so `log` is callable directly *and* exposes .info/.warn/.error.
  };
}

// Make a callable+method logger: `log("msg")` works AND `log.warn("msg")` works.
// This lets us replace the daemon's existing `log = (msg) => stdout.write(...)`
// with one that fans out to apx.log too, without rewriting every call site.
export function callableLogger(module) {
  const fn = (message, meta) => logInfo(module, message, meta);
  fn.info  = (message, meta) => logInfo(module, message, meta);
  fn.warn  = (message, meta) => logWarn(module, message, meta);
  fn.error = (message, meta) => logError(module, message, meta);
  return fn;
}
