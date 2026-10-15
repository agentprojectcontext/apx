// The owner's own Claude Code and Codex sessions, read from where those CLIs keep them (~/.claude, ~/.codex), so one
// can go on in APX. Read-only: nothing here writes there. Only each file's start and end are read to list it; a
// transcript is read whole only when it is opened.
import fs from "node:fs";
import path from "node:path";
import { codexState } from "./codex-state.ts";
import { sessionFile, sessionText } from "./native-read.ts";

export type NativeEngine = "claude" | "codex";
export type NativeSession = {
  id: string;
  engine: NativeEngine;
  title: string;
  /** The folder it ran in: the session goes on there. */
  cwd: string;
  updated_at: string;
  file: string;
};
export type NativeTurn = { role: "user" | "assistant"; text: string };
export type NativeHomes = { claude: string; codex: string };

/** How APX frames an agent's turn ("[context: …]", "[contexto: …]"): such a session is APX's own, not the owner's. */
const APX_FRAMING = /^\[(context|contexto):/;
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 128 * 1024;
const TITLE_CHARS = 80;

function readSlice(file: string, from: "start" | "end", bytes: number): string {
  // A compressed rollout has no cheap slice: it is read whole.
  if (file.endsWith(".zst")) return sessionText(file) ?? "";
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from === "start" ? 0 : size - len);
    const text = buf.toString("utf8");
    // A cut line at the edge is dropped: only whole JSON lines are read.
    const lines = text.split("\n");
    if (from === "start" && len < size) lines.pop();
    if (from === "end" && len < size) lines.shift();
    return lines.join("\n");
  } finally {
    fs.closeSync(fd);
  }
}

function* jsonLines(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as unknown;
      if (v && typeof v === "object") yield v as Record<string, unknown>;
    } catch {}
  }
}

const TEXT_PARTS = new Set(["text", "input_text", "output_text"]);
/** What the CLI itself adds around the owner's words: commands, reminders, caveats, AGENTS.md, environment. */
const wrapper = (t: string) =>
  t.startsWith("<") || t.startsWith("Caveat:") || t.startsWith("[Request interrupted") || t.startsWith("# AGENTS.md");

/** The words in a message (a string or text parts), without the CLI's own wrappers. */
function textOf(content: unknown): string {
  const parts =
    typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.flatMap((p) => {
            const part = p as { type?: unknown; text?: unknown } | null;
            return part && TEXT_PARTS.has(String(part.type)) ? [String(part.text ?? "")] : [];
          })
        : [];
  return parts
    .map((t) => t.trim())
    .filter((t) => t && !wrapper(t))
    .join("\n")
    .trim();
}

/** A Codex line that is a message of the owner or the engine (its developer and system messages left out). */
function codexMessage(o: Record<string, unknown>): NativeTurn | undefined {
  const p = (o.payload ?? {}) as Record<string, unknown>;
  if (o.type !== "response_item" || p.type !== "message" || (p.role !== "user" && p.role !== "assistant"))
    return undefined;
  const text = textOf(p.content);
  return text ? { role: p.role, text } : undefined;
}

const short = (s: string) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > TITLE_CHARS ? `${one.slice(0, TITLE_CHARS - 1)}…` : one;
};

const newest = <T extends { mtime: number }>(xs: T[], limit: number) =>
  xs.sort((a, b) => b.mtime - a.mtime).slice(0, limit);

function files(dir: string, depth: number, match: (name: string) => boolean): Array<{ file: string; mtime: number }> {
  const out: Array<{ file: string; mtime: number }> = [];
  const walk = (d: string, left: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && left > 0) walk(p, left - 1);
      else if (e.isFile() && match(e.name))
        try {
          out.push({ file: p, mtime: fs.statSync(p).mtimeMs });
        } catch {}
    }
  };
  walk(dir, depth);
  return out;
}

/** Claude Code: ~/.claude/projects/<folder>/<session>.jsonl. Titled by its name (if renamed) or first prompt. */
function claudeSession(file: string, mtime: number): NativeSession | undefined {
  let cwd = "";
  let first = "";
  for (const o of jsonLines(readSlice(file, "start", HEAD_BYTES))) {
    if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
    if (!first && o.type === "user" && !o.isMeta && !o.isSidechain)
      first = textOf((o.message as { content?: unknown } | undefined)?.content);
    if (cwd && first) break;
  }
  let title = "";
  for (const o of jsonLines(readSlice(file, "end", TAIL_BYTES)))
    if (o.type === "custom-title" && typeof o.customTitle === "string") title = o.customTitle;
  // A turn APX itself ran on Claude Code (an agent's chat) starts with APX's framing: not one of the owner's sessions.
  if (!cwd || (!first && !title) || APX_FRAMING.test(first)) return undefined;
  return {
    id: path.basename(file, ".jsonl"),
    engine: "claude",
    title: short(title || first),
    cwd,
    updated_at: new Date(mtime).toISOString(),
    file,
  };
}

/** Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl; names in session_index.jsonl when it has one. */
function codexSession(file: string, mtime: number, names: Map<string, string>): NativeSession | undefined {
  let id = "";
  let cwd = "";
  let first = "";
  for (const o of jsonLines(readSlice(file, "start", HEAD_BYTES))) {
    const p = (o.payload ?? {}) as Record<string, unknown>;
    if (o.type === "session_meta") {
      // APX's own runs (through the SDK) and Codex's sub-agents are not sessions the owner opened.
      if (p.originator === "codex_sdk_ts" || (p.source && typeof p.source === "object")) return undefined;
      id = String(p.id ?? "");
      cwd = String(p.cwd ?? "");
    }
    if (!first) first = codexMessage(o)?.role === "user" ? (codexMessage(o)?.text ?? "") : "";
    if (id && first) break;
  }
  const title = names.get(id) ?? first;
  if (!id || !cwd || !title) return undefined;
  return { id, engine: "codex", title: short(title), cwd, updated_at: new Date(mtime).toISOString(), file };
}

function codexNames(home: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    for (const o of jsonLines(fs.readFileSync(path.join(home, "session_index.jsonl"), "utf8")))
      if (typeof o.id === "string" && typeof o.thread_name === "string") names.set(o.id, o.thread_name);
  } catch {}
  return names;
}

/** The newest sessions of an engine on this machine, most recent first. */
export function nativeSessions(homes: NativeHomes, engine: NativeEngine, limit: number): NativeSession[] {
  if (engine === "claude") {
    const found = newest(
      files(path.join(homes.claude, "projects"), 1, (n) => n.endsWith(".jsonl")),
      limit * 2,
    );
    return found.flatMap((f) => claudeSession(f.file, f.mtime) ?? []).slice(0, limit);
  }
  const state = codexState(homes.codex);
  if (state)
    return state.threads.slice(0, limit).flatMap((t) => {
      const file = sessionFile(t.file);
      return file
        ? [{ id: t.id, engine: "codex" as const, title: short(t.title), cwd: t.cwd, updated_at: t.updated_at, file }]
        : [];
    });
  const names = codexNames(homes.codex);
  const found = newest(
    files(path.join(homes.codex, "sessions"), 3, (n) => n.startsWith("rollout-") && /\.jsonl(\.zst)?$/.test(n)),
    limit * 2,
  );
  return found.flatMap((f) => codexSession(f.file, f.mtime, names) ?? []).slice(0, limit);
}

/** One session by id, wherever it is among the newest `scan`. */
export function nativeSession(homes: NativeHomes, engine: NativeEngine, id: string): NativeSession | undefined {
  return nativeSessions(homes, engine, 1000).find((s) => s.id === id);
}

/** What was said in a session, owner and engine, text only (tool calls and their output left out). */
export function nativeTranscript(s: NativeSession, max: number): NativeTurn[] {
  const turns: NativeTurn[] = [];
  const text = sessionText(s.file);
  if (text === undefined) return [];
  for (const o of jsonLines(text)) {
    if (s.engine === "claude") {
      if (o.isSidechain || o.isMeta) continue;
      const content = (o.message as { content?: unknown } | undefined)?.content;
      if (o.type !== "user" && o.type !== "assistant") continue;
      const t = textOf(content);
      if (t) turns.push({ role: o.type, text: t });
    } else {
      const m = codexMessage(o);
      if (m) turns.push(m);
    }
  }
  return turns.slice(-max);
}
