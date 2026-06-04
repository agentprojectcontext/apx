// Conversation compaction: collapses a long conversation into a dense summary
// turn, preserving the last N turns for immediate context.
//
// On disk, a compacted file looks like:
//
//   ---
//   ...frontmatter...
//   status: compacted
//   compacted_at: 2026-05-08T12:00:00Z
//   compacted_turns: 47
//   ---
//
//   ## compact — 2026-05-08T12:00:00Z
//   [Compacted 47 turns on 2026-05-08T12:00:00Z]
//
//   <dense summary here>
//
//   ## user — ...          ← last KEEP_LAST turns kept verbatim
//   ...
//
// When the chat endpoint reads a compacted conversation it injects the compact
// block into the system prompt (not into messages[]), so the model has context
// without burning tokens on old exchanges.

import fs from "node:fs";
import path from "node:path";
import { parseConversation } from "./conversations.js";
import { callEngine } from "../../core/engines/index.js";

const KEEP_LAST = 6;

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const COMPACT_SYSTEM =
  "You summarize conversations for AI agent context continuity. " +
  "Be dense and factual — another AI will read this to continue the work.";

const COMPACT_PROMPT = `Summarize this conversation for future context.

Cover:
- Main task or goal being worked on
- Key decisions made and why
- Files, code, commands modified (exact paths where relevant)
- Current state: what's done, what's pending or unresolved
- Errors encountered and how they were resolved

Style: dense and factual. No pleasantries. No meta-commentary. Just the facts.

---

`;

// Resolve the most-recent conversation file for an agent, or the one explicitly
// named. Returns the full filepath.
function resolveConvFile(storagePath, agentSlug, filename) {
  const dir = path.join(storagePath, "agents", agentSlug, "conversations");
  if (!fs.existsSync(dir)) throw new Error(`no conversations dir for agent "${agentSlug}"`);

  if (filename) {
    const f = filename.endsWith(".md") ? filename : `${filename}.md`;
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) throw new Error(`conversation not found: ${f}`);
    return p;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  if (!files.length) throw new Error(`no conversations found for agent "${agentSlug}"`);
  return path.join(dir, files[files.length - 1]);
}

// Rebuild frontmatter string from a plain object.
function serializeFm(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v ?? ""}`)
    .join("\n");
}

export async function compactConversation({
  storagePath,
  agentSlug,
  filename,
  modelId,
  config,
}) {
  const filepath = resolveConvFile(storagePath, agentSlug, filename);
  const raw = fs.readFileSync(filepath, "utf8");
  const { fm, turns } = parseConversation(raw);

  // Exclude any existing compact markers from the turn count / transcript.
  const realTurns = turns.filter((t) => t.role !== "compact");
  if (realTurns.length === 0) throw new Error("nothing to compact — no user/assistant turns");

  // Build a readable transcript for the model.
  const transcript = realTurns
    .map((t) => `[${t.role.toUpperCase()}]\n${t.content}`)
    .join("\n\n---\n\n");

  const result = await callEngine({
    modelId,
    system: COMPACT_SYSTEM,
    messages: [{ role: "user", content: COMPACT_PROMPT + transcript }],
    config,
  });

  const summary = result.text.trim();
  const ts = nowIso();
  const turnCount = realTurns.length;

  // Keep the last N real turns verbatim for immediate context.
  const recentTurns = realTurns.slice(-KEEP_LAST);

  const updatedFm = {
    ...fm,
    status: "compacted",
    compacted_at: ts,
    compacted_turns: turnCount,
    last_turn: ts,
  };

  const compactBlock =
    `## compact — ${ts}\n` +
    `[Compacted ${turnCount} turns on ${ts}]\n\n` +
    `${summary}\n\n`;

  const recentBlocks = recentTurns
    .map((t) => `## ${t.role} — ${t.ts}\n${t.content}\n\n`)
    .join("");

  const newContent = `---\n${serializeFm(updatedFm)}\n---\n\n${compactBlock}${recentBlocks}`;
  fs.writeFileSync(filepath, newContent);

  return {
    filename: path.basename(filepath),
    compacted_turns: turnCount,
    kept_turns: recentTurns.length,
    model: modelId,
    summary,
    usage: result.usage,
  };
}
