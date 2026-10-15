// The core's log file, <home>/logs/core.log, however APX runs (desktop app, service, pnpm dev), and reading its tail
// for the panel and `apx logs`. See DECISIONS.md#d-084
import fs from "node:fs";
import path from "node:path";

export const LOG_LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Where a core on this home writes its log. */
export const coreLogFile = (home: string) => path.join(home, "logs", "core.log");

/** A log this big is moved to core.log.1 when the core starts, so the file never grows without end. */
const ROTATE_BYTES = 20 * 1024 * 1024;

/**
 * Where the logger writes: stderr, and the log file too unless stderr already is that file (the desktop app and the
 * launchd/Windows service send the core's output there, so writing it again would double every line).
 */
export function coreLogSink(home: string): (line: string) => void {
  const file = coreLogFile(home);
  const toStderr = (line: string) => void process.stderr.write(line);
  if (stderrIs(file)) return toStderr;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > ROTATE_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    return toStderr;
  }
  const out = fs.createWriteStream(file, { flags: "a" });
  // A full disk or a removed folder must not take the core down: stderr still gets every line.
  out.on("error", () => {});
  return (line) => {
    toStderr(line);
    if (out.writable) out.write(line);
  };
}

function stderrIs(file: string): boolean {
  try {
    const err = fs.fstatSync(2);
    const f = fs.statSync(file);
    return err.isFile() && err.dev === f.dev && err.ino === f.ino;
  } catch {
    return false;
  }
}

export type LogLine = { t?: string; level: LogLevel; scope: string; msg: string; detail?: string };
export type LogQuery = {
  limit: number;
  level?: LogLevel | undefined;
  scope?: string | undefined;
  q?: string | undefined;
};

/** The scope of lines that are not the logger's JSON: a crash's stack trace, a supervisor's note. */
export const OUTPUT_SCOPE = "output";
const MAX_SCAN = 8 * 1024 * 1024;
const CHUNK = 256 * 1024;
const MAX_TEXT = 2000;

/** The newest lines matching the query, oldest first, read from the end so a large log is not loaded whole. */
export function readCoreLog(
  file: string,
  query: LogQuery,
): { exists: boolean; lines: LogLine[]; scopes: string[]; more: boolean } {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return { exists: false, lines: [], scopes: [], more: false };
  }
  const found: LogLine[] = [];
  const scopes = new Set<string>();
  const needle = query.q?.trim().toLowerCase();
  let more = false;
  try {
    let end = fs.fstatSync(fd).size;
    const floor = Math.max(0, end - MAX_SCAN);
    let carry = Buffer.alloc(0);
    while (end > floor && !more) {
      const start = Math.max(floor, end - CHUNK);
      const chunk = Buffer.alloc(end - start);
      fs.readSync(fd, chunk, 0, chunk.length, start);
      const buf = Buffer.concat([chunk, carry]);
      // A chunk's first line may be cut: it waits for the next chunk, unless this is the top of the scan.
      const cut = start > floor ? buf.indexOf(10) : -1;
      carry = cut >= 0 ? buf.subarray(0, cut) : Buffer.alloc(0);
      const lines = buf
        .subarray(cut + 1)
        .toString("utf8")
        .split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const raw = lines[i]?.trim();
        if (!raw) continue;
        const line = parseLine(raw);
        scopes.add(line.scope);
        if (!matches(line, raw, query, needle)) continue;
        if (found.length === query.limit) {
          more = true;
          break;
        }
        found.push(line);
      }
      end = start;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { exists: true, lines: found.reverse(), scopes: [...scopes].sort(), more };
}

function matches(line: LogLine, raw: string, query: LogQuery, needle: string | undefined): boolean {
  if (query.level && line.level !== query.level) return false;
  if (query.scope && line.scope !== query.scope) return false;
  return !needle || raw.toLowerCase().includes(needle);
}

const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

/** One line of the file: the logger's JSON, or plain output kept as it is. */
export function parseLine(raw: string): LogLine {
  if (raw.startsWith("{")) {
    try {
      const { t, level, scope, msg, ...rest } = JSON.parse(raw) as Record<string, unknown>;
      if (typeof msg === "string") {
        const detail = Object.keys(rest).length ? clip(JSON.stringify(rest)) : undefined;
        return {
          ...(typeof t === "string" ? { t } : {}),
          level: LOG_LEVELS.includes(level as LogLevel) ? (level as LogLevel) : "info",
          scope: typeof scope === "string" && scope ? scope : OUTPUT_SCOPE,
          msg: clip(msg),
          ...(detail ? { detail } : {}),
        };
      }
    } catch {
      // Not the logger's line after all: kept as output below.
    }
  }
  const failed = /(?:error|exception)\b|\b(?:fatal|uncaught|panic)\b|^at\s/i.test(raw);
  return { level: failed ? "error" : "info", scope: OUTPUT_SCOPE, msg: clip(raw) };
}
