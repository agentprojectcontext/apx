// A project agent's durable memory. ONE location, no second candidate:
//
//   ~/.apx/projects/<apx_id>/agents/<slug>/memory.md
//
// It is runtime state, so it lives in the APX home and never inside the user's
// repo. `.apc/` is the committed half of a project (agent definitions, skills,
// curated project memory) and an agent's memory is none of those: it is written
// by the agent itself, turn after turn, and nobody reviews it before it lands.
// An older layout wrote it to `.apc/agents/<slug>/memory.md`; that path is gone
// on purpose — two candidate files means half the writes land where the next
// read does not look.
import fs from "node:fs";
import path from "node:path";
import { projectStorageRoot } from "../config/index.js";
import { getOrCreateApxId } from "../apc/scaffold.js";

const EMPTY_MEMORY = (slug) =>
  `# Memory — ${slug}\n\n` +
  `## Identity\n- \n\n` +
  `## Long-term facts\n- \n\n` +
  `## Recent context\n- \n`;

export function agentRuntimeDir(projectOrRoot, slug) {
  const storagePath =
    typeof projectOrRoot === "object" && projectOrRoot?.storagePath
      ? projectOrRoot.storagePath
      : null;
  const root =
    typeof projectOrRoot === "string"
      ? projectOrRoot
      : projectOrRoot?.path;
  const base = storagePath || projectStorageRoot(getOrCreateApxId(root));
  return path.join(base, "agents", slug);
}

export function agentMemoryPath(projectOrRoot, slug) {
  return path.join(agentRuntimeDir(projectOrRoot, slug), "memory.md");
}

export function ensureAgentRuntimeDir(projectOrRoot, slug, { createMemory = false } = {}) {
  const dir = agentRuntimeDir(projectOrRoot, slug);
  fs.mkdirSync(dir, { recursive: true });
  if (createMemory) {
    const memory = path.join(dir, "memory.md");
    if (!fs.existsSync(memory)) fs.writeFileSync(memory, EMPTY_MEMORY(slug));
  }
  return dir;
}

export function readAgentMemory(projectOrRoot, slug) {
  const file = agentMemoryPath(projectOrRoot, slug);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export function writeAgentMemory(projectOrRoot, slug, body) {
  ensureAgentRuntimeDir(projectOrRoot, slug);
  const memory = agentMemoryPath(projectOrRoot, slug);
  fs.writeFileSync(memory, body);
  return memory;
}

// Append a dated note under the "## Recent context" section, creating the file
// (and the section) if missing. ONE home for the append convention so the CLI
// (`apx memory <slug> --append`) and the super-agent's `write_agent_memory` tool
// stamp memory identically. `now` is injectable so tests can pin the date.
//
// THE FAILURE THIS FIXES, from a real install: agents date and decorate the
// heading by hand — `## Recent context · estado 2026-08-19`. Detection and
// insertion used to be two different regexes, and they disagreed about that:
// detection matched the bare words anywhere, so the section counted as present,
// while insertion demanded a newline right after "context" and matched nothing.
// `String.replace` with no match returns the body unchanged, so the file was
// rewritten byte-identical and the caller printed "appended". Every note went
// nowhere, and a diff against a backup showed no change to explain it.
//
// So: ONE pattern, matching the heading LINE — whatever decorates it — used for
// both questions, and the caller is handed a body it can verify.
const RECENT_HEADING = () => /^#{2,}[ \t]+Recent context.*$/gim;

export function appendAgentMemory(projectOrRoot, slug, note, { now = new Date() } = {}) {
  ensureAgentRuntimeDir(projectOrRoot, slug);
  const text = String(note || "").trim();
  if (!text) throw new Error("note required");
  let body = readAgentMemory(projectOrRoot, slug);
  if (!body) body = EMPTY_MEMORY(slug);
  const before = body;

  const bullet = `- ${now.toISOString().slice(0, 10)}: ${text}\n`;

  // The LAST heading, not the first: these sections are dated and accumulate,
  // so the newest one is the live one. With a single undecorated section — the
  // shape the template creates — first and last are the same heading.
  const headings = [...body.matchAll(RECENT_HEADING())];
  const last = headings[headings.length - 1];

  if (!last) {
    body += body.endsWith("\n") ? "\n## Recent context\n" : "\n\n## Recent context\n";
    body += bullet;
  } else {
    // Sliced, not `replace($1…)`: the note is agent-written text, and `$&` or
    // `$1` inside it would be expanded as a replacement pattern.
    const eol = body.indexOf("\n", last.index + last[0].length);
    const at = eol === -1 ? body.length : eol + 1;
    body = body.slice(0, at) + (eol === -1 ? "\n" : "") + bullet + body.slice(at);
  }

  // Belt and braces, and the actual lesson of the bug above: the write never
  // failed — nothing checked whether the note was in what got written, so a
  // no-op reported success. Two independent invariants, because reporting
  // "appended" over a write that did not happen is worse than any error:
  //   1. the note is in the body about to be written, and
  //   2. the body is not the one we started with.
  // Anything that breaks this again breaks loudly, in front of the caller.
  if (!body.includes(bullet) || body === before) {
    throw new Error(
      `could not place the note in ${slug}'s memory (${agentMemoryPath(projectOrRoot, slug)}) — ` +
      `nothing was written. The "## Recent context" heading may be malformed.`
    );
  }
  return writeAgentMemory(projectOrRoot, slug, body);
}
