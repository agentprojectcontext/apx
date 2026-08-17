import fs from "node:fs";
import { findApfRoot } from "#core/apc/parser.js";
import { agentMemoryPath, readAgentMemory, writeAgentMemory, ensureAgentRuntimeDir } from "#core/agent/memory.js";
import { http } from "../http.js";
import {
  proposeConsolidation, applyConsolidation, revertConsolidation, notebookSize,
} from "#core/memory/consolidate.js";
import { readSelfMemory } from "#core/agent/self-memory.js";

function requireRoot() {
  const root = findApfRoot();
  if (!root) throw new Error("not inside an APC project (run `apx init` first)");
  return root;
}

async function nudgeDaemon(root) {
  try {
    if (!(await http.ping())) return;
    const projects = await http.get("/api/projects", { autoStart: false });
    const me = projects.find((p) => p.path === root);
    if (me) await http.post(`/api/projects/${me.id}/rebuild`, undefined, { autoStart: false });
  } catch {}
}

export async function cmdMemory(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx memory: missing <agent-slug>");
  const root = requireRoot();
  const memPath = agentMemoryPath(root, slug);

  if (args.flags.replace) {
    const newBody = readStdinSync();
    writeAgentMemory(root, slug, newBody);
    await nudgeDaemon(root);
    console.log(`replaced memory for ${slug} (${Buffer.byteLength(newBody)} bytes)`);
    return;
  }

  if (args.flags.append && args.flags.append !== true) {
    const note = String(args.flags.append);
    ensureAgentRuntimeDir(root, slug);
    let body = readAgentMemory(root, slug);
    if (!/##\s+Recent context/i.test(body)) {
      body += body.endsWith("\n") ? "\n## Recent context\n" : "\n\n## Recent context\n";
    }
    const today = new Date().toISOString().slice(0, 10);
    body = body.replace(/(##\s+Recent context\s*\n)/i, `$1- ${today}: ${note}\n`);
    writeAgentMemory(root, slug, body);
    await nudgeDaemon(root);
    console.log(`appended to ${slug} memory: ${note}`);
    return;
  }

  const body = readAgentMemory(root, slug);
  if (!body && !fs.existsSync(memPath)) {
    throw new Error(`no memory for "${slug}" — agent dir not yet created`);
  }
  process.stdout.write(body);
}

function readStdinSync() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  try {
    while (true) {
      const bytes = fs.readSync(0, buf, 0, buf.length);
      if (!bytes) break;
      chunks.push(buf.slice(0, bytes).toString("utf8"));
    }
  } catch {}
  return chunks.join("");
}


// ── The super-agent's own notebook (~/.apx/memory.md) ────────────────────────
//
// Distinct from `apx memory <agent-slug>` above, which is a PROJECT agent's
// memory. This one ships in every super-agent prompt on every channel, which
// is why its size is worth showing and its growth worth controlling.

export async function cmdMemoryNotebook() {
  const s = notebookSize();
  console.log(`\nnotebook: ${s.entries} entries · ${s.chars} chars · ~${s.approx_tokens} tokens`);
  // The number that matters: this is paid on every turn, of every channel.
  console.log(`  ${s.consolidated} of them written by consolidation.`);
  console.log("  This file is injected into every super-agent prompt.\n");
  const body = readSelfMemory();
  if (body.trim()) process.stdout.write(body.endsWith("\n") ? body : body + "\n");
}

/**
 * apx memory consolidate [--apply] [--limit N]
 *
 * Candidates arrive on STDIN, one per line. The DISTILLING is the caller's job
 * — a routine with a model behind it, or a person — and the JUDGEMENT about
 * what survives lives in core, so the same rules apply whoever proposes.
 *
 * Proposes by default. Writing needs --apply, because a background job that
 * silently edits the file the agent believes about itself is not something to
 * switch on quietly.
 */
export async function cmdMemoryConsolidate(args) {
  const raw = readStdinSync();
  const candidates = raw.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  if (!candidates.length) {
    console.error("apx memory consolidate: no candidates on stdin (one fact per line)");
    process.exit(1);
  }

  const limits = args?.flags?.limit ? { max_candidates: Number(args.flags.limit) } : undefined;
  const { kept, rejected } = proposeConsolidation(candidates, limits ? { limits } : {});

  if (!kept.length) {
    console.log("nothing worth saving.");
    for (const r of rejected) console.log(`  skipped: ${r.reason} — ${r.text.slice(0, 60)}`);
    return;
  }

  if (!args?.flags?.apply) {
    console.log(`would save ${kept.length}:`);
    for (const k of kept) console.log(`  + ${k}`);
    if (rejected.length) {
      console.log(`\nskipped ${rejected.length}:`);
      for (const r of rejected) console.log(`  - ${r.reason} — ${r.text.slice(0, 60)}`);
    }
    console.log("\nNothing was written. Add --apply to save.");
    return;
  }

  const { written } = applyConsolidation(kept);
  console.log(`saved ${written.length} to the notebook:`);
  for (const w of written) console.log(`  + ${w}`);
  console.log("\nUndo: apx memory revert");
}

export async function cmdMemoryRevert(args) {
  const { removed } = revertConsolidation(args?.flags?.since ? { since: String(args.flags.since) } : {});
  console.log(removed
    ? `removed ${removed} consolidated ${removed === 1 ? "entry" : "entries"} — hand-written notes untouched`
    : "nothing to revert (no consolidated entries)");
}
