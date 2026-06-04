// apx log — read the unified daemon log (~/.apx/logs/apx.log)
//
//   apx log            tail last 100 lines
//   apx log --tail N   tail last N lines
//   apx log -f         follow (tail -f)
//   apx log --follow   same as -f
//   apx log --errors   only show [ERROR] lines (works with --tail / -f too)
//
// Every line written through core/logging.js or the daemon's log() lands
// here, regardless of which module produced it (telegram, whisper, super-agent…).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APX_LOG_PATH = path.join(os.homedir(), ".apx", "logs", "apx.log");
const ERROR_TRACE_PATH = path.join(os.homedir(), ".apx", "logs", "errors.jsonl");

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", gray: "\x1b[90m", white: "\x1b[97m",
};
const colorize = (line) =>
  line
    .replace(/^\[([\d-]+\s[\d:.]+)\]/, (_m, ts) => `[${c.gray}${ts}${c.reset}]`)
    .replace(/\[ERROR\s*\]/, `[${c.red}ERROR${c.reset}]`)
    .replace(/\[WARN\s*\]/, `[${c.yellow}WARN ${c.reset}]`)
    .replace(/\[INFO\s*\]/, `[${c.cyan}INFO ${c.reset}]`)
    .replace(/\[([a-z_-]+)\]/i, (_m, mod) => `[${c.bold}${mod}${c.reset}]`);

function readLastLines(file, n) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf8");
  return content.split("\n").filter(Boolean).slice(-n);
}

function shouldShow(line, opts) {
  if (opts.errors) return /\[ERROR\s*\]/.test(line);
  return true;
}

export async function cmdLog(args = {}) {
  const flags = args.flags || {};
  const follow = !!(flags.follow || flags.f);
  const errorsOnly = !!flags.errors;
  const tail = flags.tail ? parseInt(flags.tail, 10) : 100;

  // --errors without an explicit log file inspects both the unified log AND
  // the structured errors.jsonl, since some surfaces (api routes) only emit
  // there. We surface a small banner when we hit the structured file.
  if (!fs.existsSync(APX_LOG_PATH)) {
    console.log(`${c.gray}  (no log yet at ${APX_LOG_PATH})${c.reset}`);
    if (errorsOnly && fs.existsSync(ERROR_TRACE_PATH)) {
      console.log(`${c.gray}  showing structured errors from ${ERROR_TRACE_PATH}:${c.reset}\n`);
      const traces = readLastLines(ERROR_TRACE_PATH, tail);
      for (const t of traces) {
        try {
          const j = JSON.parse(t);
          console.log(`${c.gray}[${j.ts}]${c.reset} ${c.red}ERROR${c.reset} ${c.bold}${j.surface || "api"}${c.reset} ${j.route || ""} ${j.error?.message || ""}`);
        } catch { console.log(t); }
      }
    }
    return;
  }

  const lines = readLastLines(APX_LOG_PATH, tail);
  const filtered = lines.filter((l) => shouldShow(l, { errors: errorsOnly }));
  for (const line of filtered) {
    console.log(colorize(line));
  }

  if (errorsOnly && fs.existsSync(ERROR_TRACE_PATH)) {
    const traces = readLastLines(ERROR_TRACE_PATH, tail);
    if (traces.length > 0) {
      console.log(`\n${c.gray}── structured errors (${ERROR_TRACE_PATH}) ──${c.reset}`);
      for (const t of traces) {
        try {
          const j = JSON.parse(t);
          console.log(`${c.gray}[${j.ts}]${c.reset} ${c.red}ERROR${c.reset} ${c.bold}${j.surface || "api"}${c.reset} ${j.route || ""} ${j.error?.message || ""}`);
        } catch { console.log(t); }
      }
    }
  }

  if (!follow) return;

  // tail -f mode. fs.watch on macOS sometimes loses events on heavy writes,
  // so we also poll size every 500ms as a safety net.
  let currentSize = fs.statSync(APX_LOG_PATH).size;

  const drain = () => {
    let newSize;
    try { newSize = fs.statSync(APX_LOG_PATH).size; }
    catch { return; }
    if (newSize === currentSize) return;
    if (newSize < currentSize) { currentSize = newSize; return; } // truncated/rotated
    const fd = fs.openSync(APX_LOG_PATH, "r");
    const buf = Buffer.alloc(newSize - currentSize);
    fs.readSync(fd, buf, 0, buf.length, currentSize);
    fs.closeSync(fd);
    currentSize = newSize;
    const chunkLines = buf.toString("utf8").split("\n").filter(Boolean);
    for (const l of chunkLines) {
      if (shouldShow(l, { errors: errorsOnly })) console.log(colorize(l));
    }
  };

  try { fs.watch(APX_LOG_PATH, () => drain()); } catch {}
  const poll = setInterval(drain, 500);
  // Keep process alive
  return new Promise(() => { void poll; });
}
