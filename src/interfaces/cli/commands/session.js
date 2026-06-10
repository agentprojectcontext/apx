import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { findApfRoot, readAgents } from "../../../core/apc/parser.js";
import { getOrCreateApxId } from "../../../core/apc/scaffold.js";
import { generateSessionId } from "../../../core/stores/sessions.js";
import { projectStorageRoot, ensureProjectStorage } from "../../../core/config.js";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";
import {
  ENGINES,
  findSessionAcrossEngines,
  findSessionInEngine,
} from "./sessions.js";

const STALE_HOURS = 1;

function requireRoot() {
  const root = findApfRoot();
  if (!root) throw new Error("not inside an APC project (run `apx init` first)");
  return root;
}

function requireStorageRoot(root) {
  const apxId = getOrCreateApxId(root);
  if (!apxId) throw new Error("could not resolve APX project storage id");
  return projectStorageRoot(apxId);
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { fm: {}, bodyStart: 0 };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { fm: {}, bodyStart: 0 };
  const fmText = text.slice(4, end);
  const fm = {};
  for (const line of fmText.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, bodyStart: end + 4 };
}

function setFrontmatterField(text, field, value) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const fmText = text.slice(4, end);
  const lines = fmText.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (line.match(new RegExp(`^${field}:`))) {
      found = true;
      return `${field}: ${value}`;
    }
    return line;
  });
  if (!found) out.push(`${field}: ${value}`);
  return `---\n${out.join("\n")}\n---${text.slice(end + 4)}`;
}

function listAllSessions(root) {
  const agentsDir = path.join(requireStorageRoot(root), "agents");
  if (!fs.existsSync(agentsDir)) return [];
  const out = [];
  for (const slug of fs.readdirSync(agentsDir)) {
    const dir = path.join(agentsDir, slug, "sessions");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const filepath = path.join(dir, f);
      const body = fs.readFileSync(filepath, "utf8");
      const { fm } = parseFrontmatter(body);
      out.push({
        agent: slug,
        filename: f,
        path: filepath,
        id: fm.id || f.replace(/\.md$/, ""),
        title: fm.title || "(no title)",
        status: fm.status || "",
        started: fm.started || "",
        completed: fm.completed || "",
        result: fm.result || "",
        task_ref: fm.task_ref || "",
      });
    }
  }
  return out;
}

function findSessionById(root, id) {
  for (const s of listAllSessions(root)) {
    if (s.id === id || s.filename.replace(/\.md$/, "") === id) return s;
  }
  return null;
}

function statusEmoji(status) {
  if (/complete/i.test(status)) return "✅";
  if (/in.progress/i.test(status)) return "🔄";
  if (/stale|closed/i.test(status)) return "⚠️";
  return "❓";
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (isNaN(t)) return Infinity;
  return (Date.now() - t) / 3600_000;
}

// ---------------------------------------------------------------------

export function cmdSessionNew(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx session new: missing <agent-slug>");
  const title = args.flags.title === true ? null : args.flags.title;
  if (!title) throw new Error("apx session new: --title required");

  const root = requireRoot();
  const agents = readAgents(root);
  if (!agents.find((a) => a.slug === slug)) {
    throw new Error(`agent "${slug}" not found in AGENTS.md`);
  }

  const storageRoot = requireStorageRoot(root);
  const id = generateSessionId(storageRoot, slug);
  const filename = `${id}.md`;
  const filepath = path.join(storageRoot, "agents", slug, "sessions", filename);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });

  const taskRef = args.flags["task-ref"] === true ? "" : (args.flags["task-ref"] || "");
  let body = "";
  if (args.flags.body === "-") body = readStdinSync();
  else if (args.flags.body && args.flags.body !== true) body = String(args.flags.body);

  const started = nowIso();
  const content =
    `---\n` +
    `id: ${id}\n` +
    `agent: ${slug}\n` +
    `title: ${title}\n` +
    `description: \n` +
    `task_ref: ${taskRef}\n` +
    `status: open\n` +
    `date: ${started.slice(0, 10)}\n` +
    `started: ${started}\n` +
    `completed: \n` +
    `---\n\n` +
    `# ${title}\n\n${body}\n`;

  fs.writeFileSync(filepath, content);
  console.log(`✅ Session created: ${id}`);
  console.log(`   Agent: ${slug}`);
  console.log(`   Title: ${title}`);
  console.log(`   File: ${path.relative(process.cwd(), filepath)}`);
}

export function cmdSessionList(args) {
  const root = requireRoot();
  const slug = args._[0];
  const limit = args.flags.last ? parseInt(args.flags.last, 10) : null;

  let sessions = listAllSessions(root);
  if (slug) sessions = sessions.filter((s) => s.agent === slug);
  sessions.sort((a, b) => b.filename.localeCompare(a.filename));
  if (limit) sessions = sessions.slice(0, limit);

  if (sessions.length === 0) {
    console.log("(no sessions)");
    return;
  }

  console.log(
    `${"ID".padEnd(16)} ${"S".padEnd(2)} ${"AGENT".padEnd(12)} TITLE`
  );
  console.log(
    `${"─".repeat(14).padEnd(16)} ${"─".repeat(1).padEnd(2)} ${"─".repeat(10).padEnd(12)} ${"─".repeat(40)}`
  );
  for (const s of sessions) {
    console.log(
      `${s.id.padEnd(16)} ${statusEmoji(s.status).padEnd(2)} ${s.agent.padEnd(12)} ${s.title.slice(0, 60)}`
    );
  }
}

/**
 * `apx session get <id>` — single-record fetch.
 *
 *   - Default: search the current APC project's local sessions (legacy
 *     behaviour, fast, no daemon, no engine scan).
 *   - --engine <id>  : look only inside that engine's storage (apx, claude,
 *                      codex). Useful when you want the raw transcript of a
 *                      Claude/Codex session by id.
 *   - --any          : search across every detected engine, complain on
 *                      collisions. Equivalent to how resume auto-detects.
 *   - --body         : print full file body (markdown for apx, JSONL for
 *                      engines). With --engine or --any you also get the tail
 *                      of the external transcript when present.
 *   - --tail N       : print last N bytes of the transcript.
 *   - --full         : print the entire transcript (overrides --tail).
 *   - --json         : print metadata as JSON (machine-readable).
 */
export function cmdSessionGet(args) {
  const id = args._[0];
  if (!id) throw new Error("apx session get: missing <id>");

  const engineFlag = args.flags.engine;
  const wantAny = !!args.flags.any || !!args.flags.all;

  // Engine / any modes — search engine storage directly, no APC root needed.
  if (engineFlag || wantAny) {
    let hits;
    if (engineFlag && engineFlag !== true) {
      const hit = findSessionInEngine(String(engineFlag), id);
      hits = hit ? [hit] : [];
    } else {
      hits = findSessionAcrossEngines(id);
    }
    if (hits.length === 0) {
      throw new Error(`session "${id}" not found in any detected engine`);
    }
    if (hits.length > 1) {
      console.error(`⚠️ session id "${id}" exists in multiple engines:`);
      for (const h of hits) console.error(`  - ${h.engine}: ${h.path}`);
      throw new Error(`use --engine <id> to disambiguate`);
    }
    return printEngineSession(hits[0], args);
  }

  // Legacy / default — local APC project session lookup.
  const root = requireRoot();
  const s = findSessionById(root, id);
  if (!s) {
    throw new Error(
      `session "${id}" not found in this APC project — try \`apx session get ${id} --any\` to search every engine`
    );
  }
  if (args.flags.json) {
    console.log(
      JSON.stringify(
        {
          id: s.id,
          agent: s.agent,
          title: s.title,
          status: s.status,
          started: s.started,
          completed: s.completed,
          task_ref: s.task_ref,
          result: s.result,
          path: s.path,
        },
        null,
        2
      )
    );
    return;
  }
  if (args.flags.body || args.flags.full) {
    process.stdout.write(fs.readFileSync(s.path, "utf8"));
    return;
  }
  console.log(`id:        ${s.id}`);
  console.log(`agent:     ${s.agent}`);
  console.log(`title:     ${s.title}`);
  console.log(`status:    ${s.status}`);
  console.log(`started:   ${s.started}`);
  console.log(`completed: ${s.completed}`);
  console.log(`task_ref:  ${s.task_ref}`);
  console.log(`result:    ${s.result}`);
  console.log(`file:      ${path.relative(process.cwd(), s.path)}`);
}

// Print one engine session (apx | claude | codex). Shared by both
// `apx session get --engine ...` and `apx session resume <id>`.
function printEngineSession(meta, args) {
  const engine = ENGINES[meta.engine];
  const tailBytes = parseTailBytes(args.flags.tail);
  const reading = engine.readSession(meta, { tailBytes: tailBytes || 64 * 1024 });

  if (args.flags.json) {
    console.log(
      JSON.stringify(
        {
          engine: meta.engine,
          id: meta.id,
          path: meta.path,
          cwd: meta.cwd,
          mtime: meta.mtime,
          title: meta.title,
          agent_slug: meta.agentSlug || null,
          format: reading.format || null,
          size: reading.size || 0,
          external: reading.external
            ? { path: reading.external.path, size: reading.external.size }
            : null,
        },
        null,
        2
      )
    );
    if (args.flags.body || args.flags.full) process.stdout.write(reading.raw || "");
    return;
  }

  console.log(`# session ${meta.id} (engine: ${meta.engine})`);
  console.log(`path:  ${meta.path}`);
  if (meta.cwd) console.log(`cwd:   ${meta.cwd}`);
  if (meta.title) console.log(`title: ${meta.title}`);
  if (meta.agentSlug) console.log(`agent: ${meta.agentSlug}`);
  console.log("");
  if (!reading.found) {
    console.log("(transcript file no longer exists on disk)");
    return;
  }
  const wantFull = !!args.flags.full || !!args.flags.body;
  const explicitTail = tailBytes !== null && tailBytes !== undefined;
  if (wantFull) {
    console.log("--- transcript (full) ---");
    process.stdout.write(reading.raw);
  } else if (explicitTail) {
    console.log(`--- transcript (last ${reading.tail.length} bytes) ---`);
    process.stdout.write(reading.tail);
  } else {
    // Default summary view: counts + hint, no body dump.
    console.log(`format: ${reading.format} (${reading.size} bytes)`);
    if (reading.external) {
      console.log(
        `external: ${reading.external.path} (${reading.external.size} bytes)`
      );
    }
    console.log(
      `(use --body / --full to dump the transcript, or --tail N for last N bytes)`
    );
  }
}

// Parse --tail value. "--tail" alone → default 16KB. "--tail 32k" / "--tail
// 8000" / "--tail 1M" → explicit byte count. Returns null when --tail absent,
// undefined when --tail is true (no value).
function parseTailBytes(flag) {
  if (flag === undefined) return null;
  if (flag === true) return 16 * 1024;
  const s = String(flag).trim().toLowerCase();
  const m = s.match(/^(\d+)\s*([kmg]?)$/);
  if (!m) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 16 * 1024;
  }
  const n = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === "k") return n * 1024;
  if (unit === "m") return n * 1024 * 1024;
  if (unit === "g") return n * 1024 * 1024 * 1024;
  return n;
}

export function cmdSessionUpdate(args) {
  const id = args._[0];
  if (!id) throw new Error("apx session update: missing <id>");
  const root = requireRoot();
  const s = findSessionById(root, id);
  if (!s) throw new Error(`session "${id}" not found`);

  let text = fs.readFileSync(s.path, "utf8");
  const fields = ["status", "result", "title", "task_ref", "completed"];
  let touched = [];
  for (const k of fields) {
    if (args.flags[k] !== undefined && args.flags[k] !== true) {
      text = setFrontmatterField(text, k, args.flags[k]);
      touched.push(k);
    }
  }
  if (touched.length === 0) throw new Error("apx session update: no fields provided");
  fs.writeFileSync(s.path, text);
  console.log(`updated ${s.id}: ${touched.join(", ")}`);
}

export function cmdSessionClose(args) {
  const id = args._[0];
  if (!id) throw new Error("apx session close: missing <id>");
  const root = requireRoot();
  const s = findSessionById(root, id);
  if (!s) throw new Error(`session "${id}" not found`);

  let text = fs.readFileSync(s.path, "utf8");
  text = setFrontmatterField(text, "status", "✅ Completed");
  text = setFrontmatterField(text, "completed", nowIso());
  if (args.flags.result && args.flags.result !== true) {
    text = setFrontmatterField(text, "result", String(args.flags.result));
  }
  fs.writeFileSync(s.path, text);
  console.log(`✅ Session ${s.id} closed`);
}

export function cmdSessionCheck() {
  const root = requireRoot();
  const sessions = listAllSessions(root).filter((s) =>
    /in.progress/i.test(s.status)
  );

  if (sessions.length === 0) {
    console.log("✅ No active sessions. Safe to proceed.");
    process.exit(0);
  }

  let active = 0;
  let stale = [];
  for (const s of sessions) {
    const h = hoursSince(s.started);
    if (h >= STALE_HOURS) {
      stale.push({ ...s, hours: h });
    } else {
      console.log(`🔄 ACTIVE: ${s.id} (${s.hours = h.toFixed(1)}h ago)`);
      console.log(`   Agent: ${s.agent}`);
      console.log(`   Title: ${s.title}`);
      active++;
    }
  }
  if (stale.length) {
    console.log(`\nStale sessions (>${STALE_HOURS}h, can be auto-closed):`);
    for (const s of stale) {
      console.log(`⚠️  ${s.id} (${s.hours.toFixed(1)}h) — ${s.agent} — ${s.title}`);
    }
    console.log(`   → Run: apx session close-stale`);
  }
  if (active === 0) {
    console.log("✅ Safe to proceed (only stale sessions).");
    process.exit(0);
  }
  console.log("\n⛔ Another agent is working. Wait or coordinate.");
  process.exit(1);
}

/**
 * `apx session resume <id>` — locate a session by id across every detected
 * engine (apx | claude | codex), then optionally:
 *
 *   --engine <id>      restrict the search to one engine.
 *   --summary          run the super-agent over the transcript tail (needs
 *                      the daemon + super-agent configured).
 *   --tail N|--full    print the transcript (last N bytes, or everything).
 *   --continue         spawn the native CLI to resume the session
 *                      interactively (claude --resume, codex resume, …).
 *   --into apx[:slug]  create a *new* APX session whose body is the summary
 *                      of <id>, so a fresh chat can pick up the thread.
 *
 * No --engine + multiple matches → list collisions and exit non-zero, so the
 * caller can re-run with --engine.
 */
// Resolve a single session by id across engines (or one engine via --engine).
// Throws on zero matches; on a multi-engine collision it prints the candidates
// and exits with code 2 (shared by resume / summary / ask).
function resolveSingleSessionMeta(id, args, { verb = "resume" } = {}) {
  if (!id) throw new Error(`apx session ${verb}: missing <session-id>`);
  const engineFlag = args.flags.engine;
  let hits;
  if (engineFlag && engineFlag !== true) {
    const hit = findSessionInEngine(String(engineFlag), id);
    hits = hit ? [hit] : [];
  } else {
    hits = findSessionAcrossEngines(id);
  }
  if (hits.length === 0) {
    throw new Error(
      `session "${id}" not found in any detected engine` +
        (engineFlag ? ` (engine="${engineFlag}")` : "")
    );
  }
  if (hits.length > 1) {
    console.error(`⚠️  session id "${id}" exists in multiple engines:`);
    for (const h of hits) {
      console.error(`  - ${h.engine.padEnd(7)} ${h.path}${h.cwd ? `  (cwd: ${h.cwd})` : ""}`);
    }
    console.error(`→ re-run with --engine <id> to pick one (apx | claude | codex)`);
    process.exit(2);
  }
  return hits[0];
}

export async function cmdSessionResume(args) {
  const id = args._[0];

  // ── 1. Resolve which engine owns this id ─────────────────────────────────
  const meta = resolveSingleSessionMeta(id, args, { verb: "resume" });

  // ── 2. Print metadata + optional transcript dump ─────────────────────────
  printEngineSession(meta, args);

  // ── 3. Optional super-agent summary ──────────────────────────────────────
  let summaryText = null;
  if (args.flags.summary || args.flags.summarize) {
    try {
      summaryText = await summarizeSession(meta, args);
      if (summaryText) {
        console.log("");
        console.log("## summary (super-agent)");
        console.log(summaryText);
      }
    } catch (e) {
      console.log("");
      console.log(`## summary: (failed — ${e.message})`);
    }
  }

  // ── 4. Optional spawn of native CLI to continue ──────────────────────────
  if (args.flags.continue) {
    const spec = spawnContinueSpec(meta);
    if (!spec) {
      console.log("");
      console.log(`(--continue not supported for engine "${meta.engine}")`);
    } else {
      console.log("");
      console.log(`→ launching: ${spec.bin} ${spec.args.join(" ")}`);
      if (spec.cwd) console.log(`   cwd: ${spec.cwd}`);
      const child = spawn(spec.bin, spec.args, {
        cwd: spec.cwd || process.cwd(),
        stdio: "inherit",
      });
      await new Promise((resolve) => {
        child.on("exit", (code) => {
          if (code !== 0) console.log(`(native CLI exited with code ${code})`);
          resolve();
        });
        child.on("error", (e) => {
          console.log(`(failed to launch ${spec.bin}: ${e.message})`);
          resolve();
        });
      });
    }
  }

  // ── 5. Optional --into apx[:slug] : seed a new APX session with the summary ─
  if (args.flags.into) {
    const intoSpec = String(args.flags.into);
    if (!intoSpec.startsWith("apx")) {
      console.log("");
      console.log(`(--into "${intoSpec}" not supported — only "apx" or "apx:<slug>")`);
    } else {
      const slug = intoSpec.includes(":") ? intoSpec.split(":")[1] : null;
      try {
        const summary = summaryText || (await summarizeSession(meta, args).catch(() => null));
        const created = createApxFollowupSession(meta, slug, summary, args);
        console.log("");
        console.log(`✅ new APX session: ${created.id}`);
        console.log(`   agent:  ${created.agent}`);
        console.log(`   file:   ${path.relative(process.cwd(), created.path)}`);
        console.log(`   parent: ${meta.engine}:${meta.id}`);
      } catch (e) {
        console.log("");
        console.log(`(--into failed: ${e.message})`);
      }
    }
  }
}

// Ask the super-agent on the daemon to summarize a session. The daemon already
// exposes /projects/:pid/sessions/:id/resume?summarize=true for native APX
// sessions; we re-use that path when possible, and fall back to the project-
// agnostic summarizer for claude/codex.
async function summarizeSession(meta, args) {
  if (meta.engine === "apx") {
    const pid = await resolveProjectId(args?.flags?.project);
    const r = await http.get(
      `/projects/${pid}/sessions/${meta.id}/resume?summarize=true`
    );
    return r.summary || null;
  }
  // Non-apx: map-reduce the whole (binary-stripped) transcript. A byte-tail is
  // unreliable here — the end of these JSONL transcripts is token-count
  // bookkeeping, not conversation, so it has nothing to summarize.
  const label = `${meta.engine} session "${meta.title || "(untitled)"}"`;
  const head =
    `Title: ${meta.title || "(none)"}\nCwd:   ${meta.cwd || "(unknown)"}\n`;
  const { text } = await mapReduceSession(meta, {
    note: "summary",
    args,
    oneShot: (t) =>
      `Summarize what happened in this ${label} in 4 concrete bullets, then list ` +
      `the next 1-2 obvious next steps. Reply in the user's language.\n\n${head}\n` +
      `--- transcript ---\n${t}`,
    mapInstruction: (chunk, i, n) =>
      `Extract the key actions, decisions, file changes, and outcomes from part ` +
      `${i}/${n} of a ${label} transcript. If this part is only bookkeeping/noise, ` +
      `reply exactly "(nada relevante)". Be terse.\n\n--- part ${i}/${n} ---\n${chunk}`,
    reduceInstruction: (notes) =>
      `From these notes extracted across a ${label}, write 4 concrete bullets of what ` +
      `happened, then 1-2 obvious next steps. Reply in the user's language.\n\n${head}\n` +
      `Notes:\n\n${notes.join("\n\n")}`,
  });
  return text || null;
}

// `apx session summary <id>` — discoverable alias for `resume <id> --summary`.
// Resolves the engine, then prints just the LLM summary (no metadata noise).
export async function cmdSessionSummary(args) {
  const id = args._[0];
  const meta = resolveSingleSessionMeta(id, args, { verb: "summary" });
  const summary = await summarizeSession(meta, args);
  if (!summary) {
    throw new Error(
      "no summary produced — is the daemon up with super_agent.enabled in ~/.apx/config.json?"
    );
  }
  console.log(`# summary — ${meta.engine}:${meta.id}`);
  if (meta.title) console.log(`> ${meta.title}`);
  console.log("");
  console.log(summary);
}

// Pick the richest transcript text available for a session: prefer an attached
// external JSONL (apx sessions that wrap another engine) over the .md/raw body.
function sessionFullText(meta) {
  const engine = ENGINES[meta.engine];
  const reading = engine.readSession(meta, { tailBytes: 1 << 30 });
  if (!reading.found) return null;
  return reading.external?.raw || reading.raw || null;
}

// Transcripts (especially Codex/Claude JSONL) embed base64 image payloads and
// other binary blobs that are pure noise for an LLM and waste chunk budget.
// Drop data: URIs and any long unbroken base64-ish run, leaving a "[binary
// omitted]" marker so the surrounding JSON structure stays readable.
function stripBinaryNoise(text) {
  if (!text) return text;
  return text
    .replace(/data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g, "[binary omitted]")
    .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, "[binary omitted]");
}

// Split a long string into byte-bounded chunks for the map step.
function chunkText(text, chunkBytes) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkBytes) {
    chunks.push(text.slice(i, i + chunkBytes));
  }
  return chunks;
}

// We ask the summarize endpoint for a larger output budget than the
// super-agent's 512 default: "thinking" models (gemini-2.5-flash) burn output
// tokens reasoning over dense input and return empty text when the cap is too
// low. With room to answer, ~48 KB chunks summarize reliably. Most sessions
// fit in a handful of chunks; huge transcripts are capped by MR_MAX_CHUNKS
// (raise with --max-chunks).
const MR_CHUNK_BYTES = 48 * 1024;
const MR_MAX_CHUNKS = 20;
const MR_MAX_OUTPUT_TOKENS = 2048;

// Generic map-reduce over a session transcript via the project-agnostic
// /super-agent/summarize endpoint. Small (sanitized) transcripts go in one
// shot; large ones are split into parts, each mined with `mapInstruction`, and
// the surviving notes are synthesized with `reduceInstruction`. Both `ask` and
// the non-apx `summary` path build on this — the byte-tail approach fails on
// these JSONL transcripts because the tail is just token-count bookkeeping.
async function mapReduceSession(meta, { mapInstruction, reduceInstruction, oneShot, note, args }) {
  const text = stripBinaryNoise(sessionFullText(meta));
  if (!text) throw new Error(`could not read transcript for ${meta.engine}:${meta.id}`);

  const maxChunksFlag = args?.flags?.["max-chunks"];
  const maxChunks =
    maxChunksFlag && maxChunksFlag !== true
      ? Math.max(1, parseInt(maxChunksFlag, 10))
      : MR_MAX_CHUNKS;

  if (text.length <= MR_CHUNK_BYTES) {
    const r = await http.post(`/super-agent/summarize`, {
      prompt: `${oneShot(text)}`,
      context_note: `${note} (one-shot) ${meta.engine}:${meta.id}`,
      max_tokens: MR_MAX_OUTPUT_TOKENS,
    });
    return { text: r?.text || null, chunks: 1, truncated: false };
  }

  const allChunks = chunkText(text, MR_CHUNK_BYTES);
  const truncated = allChunks.length > maxChunks;
  const chunks = allChunks.slice(0, maxChunks);

  const notes = [];
  for (let i = 0; i < chunks.length; i++) {
    const r = await http.post(`/super-agent/summarize`, {
      prompt: mapInstruction(chunks[i], i + 1, chunks.length),
      context_note: `${note} map ${i + 1}/${chunks.length} ${meta.engine}:${meta.id}`,
      max_tokens: MR_MAX_OUTPUT_TOKENS,
    });
    const n = (r?.text || "").trim();
    if (n && !/^\(nada relevante\)\.?$/i.test(n)) notes.push(`[part ${i + 1}] ${n}`);
  }

  if (notes.length === 0) {
    return { text: "(no relevant content found in the transcript)", chunks: chunks.length, truncated };
  }

  const r = await http.post(`/super-agent/summarize`, {
    prompt: reduceInstruction(notes),
    context_note: `${note} reduce ${meta.engine}:${meta.id}`,
    max_tokens: MR_MAX_OUTPUT_TOKENS,
  });
  return { text: r?.text || null, chunks: chunks.length, truncated };
}

// `apx session ask <id> "<question>"` — RAG-lite Q&A over a session transcript.
export async function cmdSessionAsk(args) {
  const id = args._[0];
  const question = (args._.slice(1) || []).join(" ").trim();
  if (!question) {
    throw new Error(
      'apx session ask: missing question — e.g. apx session ask <id> "¿qué decidimos sobre el sidebar?"'
    );
  }
  const meta = resolveSingleSessionMeta(id, args, { verb: "ask" });
  const label = `${meta.engine} session "${meta.title || "(untitled)"}"`;
  const { text, chunks, truncated } = await mapReduceSession(meta, {
    note: "ask",
    args,
    oneShot: (t) =>
      `Answer the question about this ${label}.\nQuestion: ${question}\n\n` +
      `If the transcript doesn't contain the answer, say so plainly. ` +
      `Reply concisely in the user's language.\n\n--- transcript ---\n${t}`,
    mapInstruction: (chunk, i, n) =>
      `You are mining part ${i}/${n} of a ${label} transcript to help answer a question.\n` +
      `Question: ${question}\n\n` +
      `Extract ONLY facts, decisions, code changes, file paths, or context from THIS part ` +
      `that help answer it. If nothing here is relevant, reply exactly "(nada relevante)". ` +
      `Be terse.\n\n--- part ${i}/${n} ---\n${chunk}`,
    reduceInstruction: (notes) =>
      `Answer the user's question using notes extracted from a ${label}.\n` +
      `Question: ${question}\n\nNotes from ${notes.length} part(s):\n\n${notes.join("\n\n")}\n\n` +
      `Give a direct, concise answer. If the notes don't answer it, say so. Reply in the user's language.`,
  });
  if (!text) {
    throw new Error(
      "no answer produced — is the daemon up with super_agent.enabled in ~/.apx/config.json?"
    );
  }
  console.log(`# ${meta.engine}:${meta.id} — ${meta.title || "(untitled)"}`);
  console.log(`> Q: ${question}`);
  console.log("");
  console.log(text);
  if (truncated) {
    console.log("");
    console.log(
      `⚠️  transcript exceeded ${chunks} chunks — answered over the first ` +
        `${chunks} part(s). Raise with --max-chunks N for fuller coverage.`
    );
  }
}

// Map (engine, id, cwd) → how to spawn the engine's native CLI in resume mode.
function spawnContinueSpec(meta) {
  if (meta.engine === "claude") {
    return {
      bin: "claude",
      args: ["--resume", meta.id],
      cwd: meta.cwd && fs.existsSync(meta.cwd) ? meta.cwd : null,
    };
  }
  if (meta.engine === "codex") {
    return {
      bin: "codex",
      args: ["resume", meta.id],
      cwd: meta.cwd && fs.existsSync(meta.cwd) ? meta.cwd : null,
    };
  }
  // For apx-native sessions there's no "native CLI" to resume — use --into.
  return null;
}

// Create a new APX session whose body is the summary of an existing session.
// Used by `apx session resume <id> --into apx[:slug]`. Picks a sensible
// default agent slug when none is given.
function createApxFollowupSession(meta, slugArg, summary, args) {
  const root = requireRoot();
  const agents = readAgents(root);
  if (agents.length === 0) {
    throw new Error("no agents in AGENTS.md — `apx agent add <slug>` first");
  }
  let slug = slugArg || meta.agentSlug || agents[0].slug;
  if (!agents.find((a) => a.slug === slug)) {
    throw new Error(
      `agent "${slug}" not in AGENTS.md (known: ${agents.map((a) => a.slug).join(", ")})`
    );
  }

  const storageRoot = requireStorageRoot(root);
  const id = generateSessionId(storageRoot, slug);
  const filename = `${id}.md`;
  const filepath = path.join(storageRoot, "agents", slug, "sessions", filename);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });

  const title = `Continued from ${meta.engine}:${meta.id}`;
  const started = nowIso();
  const body =
    `> Spawned from \`${meta.engine}\` session \`${meta.id}\`\n` +
    `> Original cwd: ${meta.cwd || "(unknown)"}\n` +
    `> Original path: ${meta.path}\n\n` +
    (summary
      ? `## Summary of prior session\n\n${summary}\n`
      : `(no summary available — re-run with the daemon up and \`super_agent.enabled = true\` to get one)\n`);

  const content =
    `---\n` +
    `id: ${id}\n` +
    `agent: ${slug}\n` +
    `title: ${title}\n` +
    `description: \n` +
    `task_ref: \n` +
    `status: open\n` +
    `date: ${started.slice(0, 10)}\n` +
    `started: ${started}\n` +
    `completed: \n` +
    `parent_session: ${meta.engine}:${meta.id}\n` +
    `parent_session_path: ${meta.path}\n` +
    `---\n\n` +
    `# ${title}\n\n${body}\n`;

  fs.writeFileSync(filepath, content);
  return { id, agent: slug, path: filepath };
}

export function cmdSessionCloseStale() {
  const root = requireRoot();
  const sessions = listAllSessions(root).filter((s) =>
    /in.progress/i.test(s.status)
  );
  let closed = 0;
  for (const s of sessions) {
    const h = hoursSince(s.started);
    if (h < STALE_HOURS) continue;
    let text = fs.readFileSync(s.path, "utf8");
    text = setFrontmatterField(
      text,
      "status",
      `⚠️ Automatically closed (stale >${STALE_HOURS}h)`
    );
    text = setFrontmatterField(text, "completed", nowIso());
    text = setFrontmatterField(
      text,
      "result",
      `Auto-closed by apx (stale >${h.toFixed(1)}h without completion)`
    );
    fs.writeFileSync(s.path, text);
    console.log(`⚠️  Closed stale: ${s.id} (${h.toFixed(1)}h old)`);
    closed++;
  }
  if (closed === 0) console.log("No stale sessions found.");
  else console.log(`Closed ${closed} stale session(s).`);
}

export async function cmdSessionCompact(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx session compact: missing <agent-slug>");
  const convId = args.flags.conversation === true ? null : (args.flags.conversation || null);
  const model = args.flags.model === true ? null : (args.flags.model || null);

  const pid = await resolveProjectId(args?.flags?.project);

  const url = convId
    ? `/projects/${pid}/agents/${slug}/conversations/${convId}/compact`
    : `/projects/${pid}/agents/${slug}/compact`;

  const body = model ? { model } : {};

  console.log(`Compacting conversation for ${slug}${convId ? ` (${convId})` : " (latest)"}...`);
  const result = await http.post(url, body);

  console.log(`✅ Compacted ${result.compacted_turns} turns → ${result.filename}`);
  console.log(`   Kept last ${result.kept_turns} turns verbatim`);
  console.log(`   Model: ${result.model}`);
  if (result.usage) {
    const u = result.usage;
    console.log(`   Tokens: ${u.input_tokens ?? u.prompt_tokens ?? "?"} in / ${u.output_tokens ?? u.completion_tokens ?? "?"} out`);
  }
  console.log("");
  console.log("Summary:");
  console.log("─".repeat(60));
  console.log(result.summary);
}
