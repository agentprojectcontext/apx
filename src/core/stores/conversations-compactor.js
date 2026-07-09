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
import {
  renderEvents,
  buildCondenserPrompt,
  summarizeStructured,
} from "#core/memory/summarizer.js";

const KEEP_LAST = 6;

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Map a parsed conversation role to the summarizer's normalized event role.
function toEventRole(role) {
  if (role === "user") return "user";
  if (role === "tool") return "tool";
  return "assistant"; // assistant / system → assistant side
}

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

  // Same summarizer service as the automatic condenser (structured state),
  // just a different store/entry point. The whole conversation is condensed
  // (no previous-summary threading here — a fresh compact per call).
  const eventsBlock = renderEvents(
    realTurns.map((t) => ({ role: toEventRole(t.role), content: t.content }))
  );
  const prompt = buildCondenserPrompt({ eventsBlock });
  const out = await summarizeStructured({
    prompt,
    models: { primary: modelId, fallback: config?.super_agent?.model || "" },
    config,
  });
  if (!out) throw new Error("compaction failed — no model produced a summary");

  const summary = out.text;
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
    model: out.model,
    summary,
  };
}
