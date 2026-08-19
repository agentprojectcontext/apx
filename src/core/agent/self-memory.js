// The super-agent's personal, persistent notebook.
//
// Distinct from:
//   - identity.json   → who the super-agent is (name, personality, owner)
//   - project agents' ~/.apx/projects/<apx_id>/agents/<slug>/memory.md → per-agent, per-project
//   - sessions        → raw transcripts of past work (search_sessions)
//
// A single free-form markdown file at ~/.apx/memory.md kept by the super-agent
// itself: durable facts about the owner, ongoing threads, decisions, and the
// gist of what it has been working on (refreshed by skimming its own recent
// sessions). A bounded slice is injected into every super-agent prompt; the
// `remember` / `read_self_memory` tools write and read it.
//
// The header inside the file picks up the current persona name from identity
// (resolveAgentName) — never hardcode the agent name here.
import fs from "node:fs";
import path from "node:path";
import { SELF_MEMORY_PATH } from "../config/paths.js";

export { SELF_MEMORY_PATH };
import { resolveAgentName } from "../identity/index.js";
import { appendDatedBullet } from "#core/memory/dated-log.js";

function notebookHeader() {
  let name = "";
  try { name = resolveAgentName(); } catch { /* identity missing */ }
  return name ? `# ${name}'s notebook` : "# Self-memory";
}

// How much of the notebook to inline into the system prompt. The full file is
// always readable via read_self_memory; this only bounds the always-on slice
// so a long notebook can't blow the token budget on cheap channels.
export const SELF_MEMORY_PROMPT_LIMIT = 2000;

export function readSelfMemory() {
  try {
    return fs.readFileSync(SELF_MEMORY_PATH, "utf8");
  } catch {
    return "";
  }
}

/** Bounded slice for the system prompt. Returns "" when the notebook is empty. */
export function readSelfMemoryForPrompt(limit = SELF_MEMORY_PROMPT_LIMIT) {
  const body = readSelfMemory().trim();
  if (!body) return "";
  if (body.length <= limit) return body;

  // The notebook grows chronologically (oldest day first), so a naive head
  // slice injects the OLDEST notes and truncates the most recent — exactly
  // backwards for "what's relevant now". Keep the file header + the NEWEST
  // entries that fit `limit`, re-grouped under their date headings. The full
  // file is always available via read_self_memory.
  const firstLine = body.split("\n", 1)[0];
  const header = firstLine.startsWith("# ") ? firstLine : notebookHeader();
  const notice =
    "_(most recent notes — older history truncated; call read_self_memory for the full notebook)_";

  const entries = parseSelfMemoryEntries(body); // oldest → newest
  if (!entries.length) {
    // No structured bullets (free-form prose notebook) — fall back to the tail.
    const tail = body.slice(-(limit - notice.length - 2)).replace(/^\S*\n/, "");
    return `${notice}\n${tail.trim()}`;
  }

  let budget = limit - header.length - notice.length - 4;
  const picked = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const tag =
      (e.time ? `[${e.time}]` : "") +
      (e.channel && e.channel !== "memory" ? `[${e.channel}]` : "");
    const bullet = `- ${tag ? tag + " " : ""}${e.text}`.replace(/\s+/g, " ").trim();
    const cost = bullet.length + 14; // headroom for an occasional date heading
    if (budget - cost < 0 && picked.length) break;
    picked.push({ date: e.date, bullet });
    budget -= cost;
  }
  picked.reverse(); // back to chronological order (newest at the bottom)

  const out = [header, notice];
  let lastDate = "";
  for (const p of picked) {
    if (p.date && p.date !== lastDate) {
      out.push("", `## ${p.date}`);
      lastDate = p.date;
    }
    out.push(p.bullet);
  }
  return out.join("\n").trim();
}

/**
 * Append a dated note to the notebook. Creates the file (and ~/.apx) on first
 * write. The bullet format — one `## YYYY-MM-DD` heading per day, an
 * "[HH:MM][channel]" tag so the cross-channel broker and the RAG indexer can
 * attribute a note to a surface and a time — lives in core/memory/dated-log.js,
 * shared with project memory and routine memory.
 */
export function appendSelfMemory(note, opts = {}) {
  const text = String(note || "").trim();
  if (!text) throw new Error("nothing to remember (empty note)");
  fs.mkdirSync(path.dirname(SELF_MEMORY_PATH), { recursive: true });

  const next = appendDatedBullet(readSelfMemory(), text, {
    channel: opts.channel,
    time: opts.time,
    header: notebookHeader(),
  });
  fs.writeFileSync(SELF_MEMORY_PATH, next);
  return { path: SELF_MEMORY_PATH, note: text };
}

// Ensure the notebook file exists (created empty-ish on daemon boot, Pieza 1).
// Returns true if it created the file, false if it already existed.
export function ensureSelfMemoryFile() {
  try {
    if (fs.existsSync(SELF_MEMORY_PATH)) return false;
    fs.mkdirSync(path.dirname(SELF_MEMORY_PATH), { recursive: true });
    fs.writeFileSync(SELF_MEMORY_PATH, `${notebookHeader()}\n`);
    return true;
  } catch {
    return false;
  }
}

// Parse the notebook into structured entries, oldest first. Tolerant of both
// the legacy "- note" bullets and the tagged "[HH:MM][channel] note" /
// "[YYYY-MM-DD HH:MM][channel] note" forms. Each entry:
//   { date, time, channel, ts, text, line }
// `line` is the 0-based line number in the source text, so a caller editing
// the file (prune) can remove exactly this bullet and nothing around it.
export function parseSelfMemoryEntries(text) {
  const out = [];
  let date = "";
  const rawLines = String(text || "").split("\n");
  for (let li = 0; li < rawLines.length; li++) {
    const line = rawLines[li].trim();
    const h = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (h) {
      date = h[1];
      continue;
    }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (!b) continue;
    let rest = b[1].trim();
    let time = "";
    let channel = "";
    // [YYYY-MM-DD HH:MM] (full timestamp) takes precedence over a bare time.
    let m = rest.match(/^\[(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\]\s*/);
    if (m) {
      date = m[1];
      time = m[2];
      rest = rest.slice(m[0].length);
    } else {
      m = rest.match(/^\[(\d{1,2}:\d{2})\]\s*/);
      if (m) {
        time = m[1];
        rest = rest.slice(m[0].length);
      }
    }
    // [channel]
    const c = rest.match(/^\[([a-z0-9_-]+)\]\s*/i);
    if (c) {
      channel = c[1].toLowerCase();
      rest = rest.slice(c[0].length);
    }
    rest = rest.trim();
    if (!rest) continue;
    const hm = time ? time.padStart(5, "0") : "00:00";
    const ts = date ? `${date}T${hm}:00Z` : "";
    out.push({ date, time, channel: channel || "memory", ts, text: rest, line: li });
  }
  return out;
}
