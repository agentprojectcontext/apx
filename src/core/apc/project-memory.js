// A project's CURATED memory — `<repo>/.apc/memory.md`. Committed.
//
// What the PROJECT knows and the team may read: what this repo is, who owns it,
// the decisions that outlive a session. Distinct from what one agent knows
// (per-agent memory.md), from what the super-agent knows everywhere
// (~/.apx/memory.md), and — the distinction that matters most here — from the
// project's LOCAL memory (core/stores/project-memory.js), which is never
// committed and is where the agent actually writes.
//
// NOTHING AUTOMATIC WRITES THIS FILE. That is the rule, and it is APC's:
// `.apc/` memory is "only for curated project facts safe for the team", while
// private runtime memory belongs in the runtime's own store because it "often
// contains sensitive prompts, credentials pasted by mistake, customer data".
// A file that git will carry forever is written by a person who read it first.
// The writer here is the Memories editor (a human pressing Save) and the
// dangerous-gated file tools, which ask before they touch a repo.
//
// It still has an automatic READER: the RAG indexer scopes it to `project:<id>`,
// so curated facts come back as context without being re-typed.
import fs from "node:fs";
import { apcDir, apcMemoryFile } from "./paths.js";

export { apcMemoryFile as projectMemoryPath };

/** Read the memory body. "" when the file doesn't exist. Never throws. */
export function readProjectMemory(root) {
  try {
    return fs.readFileSync(apcMemoryFile(root), "utf8");
  } catch {
    return "";
  }
}

/**
 * Replace the whole body — the Memories editor's Save, and the only writer.
 * There is deliberately no append helper here: an appender is what an automatic
 * caller reaches for, and this file is not written automatically.
 */
export function writeProjectMemory(root, body) {
  const file = apcMemoryFile(root);
  fs.mkdirSync(apcDir(root), { recursive: true });
  fs.writeFileSync(file, body);
  return { path: file, bytes: Buffer.byteLength(body, "utf8") };
}
