// Roby's own notebook — the super-agent's personal, persistent memory.
//
// This is distinct from:
//   - identity.json   → who Roby is (name, personality, owner)
//   - project agents' .apc/agents/<slug>/memory.md → per-agent, per-project
//   - sessions        → raw transcripts of past work (search_sessions)
//
// It is a single free-form markdown file at ~/.apx/memory.md that Roby keeps
// itself: durable facts about the owner, ongoing threads, decisions, and the
// gist of what it has been working on (which it refreshes by skimming its own
// recent sessions). A bounded slice is injected into every super-agent prompt;
// the `remember` / `read_self_memory` tools write and read it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SELF_MEMORY_PATH = path.join(os.homedir(), ".apx", "memory.md");

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
  return body.slice(0, limit).trimEnd() + "\n… (truncated — call read_self_memory for the full notebook)";
}

/**
 * Append a dated note to the notebook. Each note is a markdown bullet under a
 * `## YYYY-MM-DD` heading so the file stays chronologically skimmable. Creates
 * the file (and ~/.apx) on first write.
 */
export function appendSelfMemory(note) {
  const text = String(note || "").trim();
  if (!text) throw new Error("nothing to remember (empty note)");
  fs.mkdirSync(path.dirname(SELF_MEMORY_PATH), { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const existing = readSelfMemory();
  const heading = `## ${today}`;
  const bullet = `- ${text.replace(/\n+/g, " ").trim()}`;

  let next;
  if (!existing.trim()) {
    next = `# Roby's notebook\n\n${heading}\n${bullet}\n`;
  } else if (existing.includes(heading)) {
    // Append the bullet under today's existing heading.
    const lines = existing.split("\n");
    const idx = lines.lastIndexOf(heading);
    // Find the end of today's block (next heading or EOF).
    let insertAt = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        insertAt = i;
        break;
      }
    }
    // Trim trailing blank lines inside the block before inserting.
    while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
    lines.splice(insertAt, 0, bullet);
    next = lines.join("\n");
    if (!next.endsWith("\n")) next += "\n";
  } else {
    const sep = existing.endsWith("\n") ? "" : "\n";
    next = `${existing}${sep}\n${heading}\n${bullet}\n`;
  }

  fs.writeFileSync(SELF_MEMORY_PATH, next);
  return { path: SELF_MEMORY_PATH, note: text };
}
