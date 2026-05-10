import fs from "node:fs";
import path from "node:path";
import { findApfRoot, readAgents } from "../../core/parser.js";
import { getOrCreateApxId } from "../../core/scaffold.js";
import { generateSessionId } from "../../core/session-store.js";
import { projectStorageRoot, ensureProjectStorage } from "../../core/config.js";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

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

export function cmdSessionGet(args) {
  const id = args._[0];
  if (!id) throw new Error("apx session get: missing <id>");
  const root = requireRoot();
  const s = findSessionById(root, id);
  if (!s) throw new Error(`session "${id}" not found`);
  if (args.flags.body) {
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

export async function cmdSessionResume(args) {
  const id = args._[0];
  if (!id) throw new Error("apx session resume: missing <session-id>");
  const pid = await resolveProjectId(args?.flags?.project);
  const summarize = args.flags.summary || args.flags.summarize ? "true" : "false";
  const result = await http.get(
    `/projects/${pid}/sessions/${id}/resume?summarize=${summarize}`
  );

  console.log(`# session ${id} (agent: ${result.agent})`);
  console.log(`path: ${result.session_path}`);
  console.log("");
  console.log("## frontmatter");
  for (const [k, v] of Object.entries(result.frontmatter || {})) {
    if (v) console.log(`${k}: ${v}`);
  }
  console.log("");
  if (result.external_transcript) {
    const t = result.external_transcript;
    console.log(`## external transcript`);
    console.log(`path: ${t.path}`);
    console.log(`size: ${t.size} bytes`);
    if (args.flags.full) {
      console.log("");
      console.log("--- tail ---");
      process.stdout.write(t.tail);
    } else {
      console.log(`(use --full to print the last ${t.tail.length} chars)`);
    }
  } else if (result.frontmatter?.external_session_path) {
    console.log(`## external transcript: ${result.frontmatter.external_session_path}`);
    console.log("(file no longer exists on disk)");
  } else {
    console.log("## external transcript: (none — runtime didn't report one)");
  }
  if (result.summary) {
    console.log("");
    console.log("## summary (super-agent)");
    console.log(result.summary);
  } else if (summarize === "true") {
    console.log("");
    console.log("## summary: (failed — super-agent not configured?)");
  }
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
