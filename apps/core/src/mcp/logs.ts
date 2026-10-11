// What MCP servers print on stderr: the last lines of each, in memory only, with the values it was given masked.

import type { Stream } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";

export type LogLine = { at: string; text: string };

const MAX_LINES = 300;
const MAX_LINE = 500;
/** Shorter values ("1", "true") are not worth hiding and would garble every line. */
const MIN_MASKED = 4;
const MASK = "•••";

/** Ring buffers of stderr lines, one per running server key. */
export function createStderrLogs(limits: { lines?: number; lineChars?: number } = {}) {
  const maxLines = limits.lines ?? MAX_LINES;
  const maxLine = limits.lineChars ?? MAX_LINE;
  const buffers = new Map<string, LogLine[]>();

  const push = (key: string, raw: string, masks: string[]) => {
    let text = stripVTControlCharacters(raw).replace(/[\p{Cc}\p{Cf}]/gu, " ");
    for (const m of masks) text = text.replaceAll(m, MASK);
    if (text.length > maxLine) text = `${text.slice(0, maxLine)}…`;
    const lines = buffers.get(key) ?? [];
    lines.push({ at: new Date().toISOString(), text });
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
    buffers.set(key, lines);
  };

  return {
    /**
     * Reads a server's stderr into its buffer until the stream ends. `secrets`: values to mask (the server's own
     * secrets and credential-like variables), longest first so one inside another is hidden whole.
     */
    follow(key: string, stream: Stream | null | undefined, secrets: string[]): void {
      if (!stream) return;
      const masks = [...new Set(secrets.filter((s) => s.length >= MIN_MASKED))].sort((a, b) => b.length - a.length);
      const decoder = new StringDecoder("utf8");
      let rest = "";
      const take = (text: string) => {
        const parts = (rest + text).split(/\r?\n/);
        rest = parts.pop() ?? "";
        // A line that never ends is cut, so one runaway write cannot grow without bound.
        if (rest.length > maxLine * 4) {
          parts.push(rest);
          rest = "";
        }
        for (const p of parts) if (p.trim()) push(key, p, masks);
      };
      stream.on("data", (chunk: Buffer | string) => take(typeof chunk === "string" ? chunk : decoder.write(chunk)));
      stream.on("end", () => {
        take(decoder.end());
        if (rest.trim()) push(key, rest, masks);
        rest = "";
      });
      stream.on("error", () => {});
    },
    /** The last `n` lines a server printed, oldest first. */
    read(key: string, n: number): LogLine[] {
      return (buffers.get(key) ?? []).slice(-n);
    },
    /** Forgets every buffer whose key passes `match` (a definition removed). */
    forget(match: (key: string) => boolean): void {
      for (const key of buffers.keys()) if (match(key)) buffers.delete(key);
    },
  };
}

export type StderrLogs = ReturnType<typeof createStderrLogs>;
