import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "./config.js";

export const LOG_DIR = path.join(APX_HOME, "logs");
export const ERROR_TRACE_PATH = path.join(LOG_DIR, "errors.jsonl");

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
