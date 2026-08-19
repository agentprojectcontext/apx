// A project's own durable memory — `<repo>/.apc/memory.md`.
//
// What the PROJECT knows, as distinct from what one agent knows (per-agent
// memory.md) and from what the super-agent knows everywhere (~/.apx/memory.md):
// what this repo is, who owns it, the decisions that outlive a session. It is
// committed with the repo, the Memories screen reads and edits it, and the RAG
// indexer scopes it to `project:<id>`.
//
// WHY THIS FILE EXISTS. The path had readers and no writer. The super-agent had
// `remember` for its own notebook and nothing at all for a project, so asked to
// write down what each project was, it improvised a `MEMORY.md` at the repo root
// — a file no screen shows and no index sees — in twelve projects at once, and
// reported success each time. The owner was told the memories were written and
// found the Memories screen unchanged, which is exactly what it looked like.
// Writes now go where the readers already look.
import fs from "node:fs";
import { apcDir, apcMemoryFile } from "./paths.js";
import { appendDatedBullet } from "#core/memory/dated-log.js";

export { apcMemoryFile as projectMemoryPath };

/** Read the memory body. "" when the file doesn't exist. Never throws. */
export function readProjectMemory(root) {
  try {
    return fs.readFileSync(apcMemoryFile(root), "utf8");
  } catch {
    return "";
  }
}

/** Replace the whole body (the Memories editor's Save). Creates `.apc/`. */
export function writeProjectMemory(root, body) {
  const file = apcMemoryFile(root);
  fs.mkdirSync(apcDir(root), { recursive: true });
  fs.writeFileSync(file, body);
  return { path: file, bytes: Buffer.byteLength(body, "utf8") };
}

/**
 * Append one dated note. Creates the file on first write, headed with the
 * project's name so the file says what it is when someone opens it in the repo
 * rather than in APX.
 */
export function appendProjectMemory(root, note, { channel = "", projectName = "" } = {}) {
  const text = String(note || "").trim();
  if (!text) throw new Error("nothing to remember (empty note)");
  const header = projectName ? `# ${projectName} — project memory` : "# Project memory";
  const next = appendDatedBullet(readProjectMemory(root), text, { channel, header });
  return { ...writeProjectMemory(root, next), note: text };
}
