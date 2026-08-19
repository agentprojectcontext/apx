// A project's LOCAL memory — `~/.apx/projects/<apxId>/memory.md`.
//
// A project has two durable memories and the difference between them is a
// safety boundary, not a filing preference:
//
//   local    ~/.apx/projects/<apxId>/memory.md   THIS file. Never committed.
//                                                Written by the agent (`remember`
//                                                with a `project`).
//   curated  <repo>/.apc/memory.md               core/apc/project-memory.js.
//                                                Committed, team-safe, written
//                                                by a person who read it first.
//
// APC draws that line itself: "private runtime memory" is runtime state and
// belongs in the runtime's own store, out of `.apc/`, because it "often contains
// sensitive prompts, credentials pasted by mistake, customer data" — while
// `.apc/` memory is "only for curated project facts safe for the team", and the
// route from one to the other is a human extracting the durable, sanitized part.
//
// So an agent appending a note about a project — a decision, a stack detail, a
// thing the owner said in passing — writes HERE. Committing that stream straight
// into someone's repo is how an API key ends up in a public git history, and no
// scrubber makes an automatic write safe enough to skip the reading.
//
// Promotion is manual and stays manual: the Memories screen shows both files, so
// moving a line from this one into the repo's is a thing a person does after
// looking at it.
import fs from "node:fs";
import path from "node:path";
import { projectStorageRoot } from "../config/index.js";
import { getOrCreateApxId } from "../apc/scaffold.js";
import { appendDatedBullet } from "#core/memory/dated-log.js";

// Accepts a registry entry ({ storagePath }) or a bare project root, matching
// core/agent/memory.js — the same two shapes callers already have in hand.
export function projectLocalMemoryPath(projectOrRoot) {
  const storagePath =
    typeof projectOrRoot === "object" && projectOrRoot?.storagePath
      ? projectOrRoot.storagePath
      : null;
  const root = typeof projectOrRoot === "string" ? projectOrRoot : projectOrRoot?.path;
  const base = storagePath || projectStorageRoot(getOrCreateApxId(root));
  return path.join(base, "memory.md");
}

/** Read the body. "" when the file doesn't exist. Never throws. */
export function readProjectLocalMemory(projectOrRoot) {
  try {
    return fs.readFileSync(projectLocalMemoryPath(projectOrRoot), "utf8");
  } catch {
    return "";
  }
}

/** Replace the whole body (the Memories editor's Save). */
export function writeProjectLocalMemory(projectOrRoot, body) {
  const file = projectLocalMemoryPath(projectOrRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return { path: file, bytes: Buffer.byteLength(body, "utf8") };
}

/** Append one dated note. Creates the file on first write. */
export function appendProjectLocalMemory(projectOrRoot, note, { channel = "", projectName = "" } = {}) {
  const text = String(note || "").trim();
  if (!text) throw new Error("nothing to remember (empty note)");
  const header = projectName
    ? `# ${projectName} — local memory (not committed)`
    : "# Project local memory (not committed)";
  const next = appendDatedBullet(readProjectLocalMemory(projectOrRoot), text, { channel, header });
  return { ...writeProjectLocalMemory(projectOrRoot, next), note: text };
}
