// Incremental indexer for the cross-channel memory RAG (Pieza 2).
//
// Walks ~/.apx/messages/<channel>/YYYY-MM-DD.jsonl for every channel (telegram,
// web, deck, voice, …) plus ~/.apx/memory.md, turns each relevant record into a
// chunk, embeds the NEW ones, and upserts them into the vector store.
//
// Incremental: a cursor file (~/.apx/memory-cursor.json) records the last
// indexed timestamp per channel, so each run only embeds messages newer than
// the last one. memory.md entries are re-derived every run but keyed by a
// content hash, so re-indexing them is idempotent (cheap, few entries).
//
// What gets indexed:
//   - type:"user" and type:"agent" turns (full body, capped)
//   - type:"tool" results, truncated to 400 chars, tagged [tool:<name>]
//   - memory.md entries as separate chunks tagged [memory]
//
// Everything is best-effort — a failure logs and returns, never throws into the
// daemon.

import fs from "node:fs";
import path from "node:path";
import { GLOBAL_MESSAGES_DIR, APX_HOME } from "../config/index.js";
import { SELF_MEMORY_PATH, parseSelfMemoryEntries } from "../agent/self-memory.js";
import { apcMemoryFile } from "../apc/paths.js";
import { embedBatch, embedOne } from "./embeddings.js";

export const CURSOR_PATH = path.join(APX_HOME, "memory-cursor.json");

const BODY_CAP = 1200; // chars kept per user/agent chunk
const TOOL_CAP = 400; // chars kept per tool-result chunk
const SCOPED_CAP = 800; // chars kept per project/agent memory block

function fnv1aHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function readIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function readCursor(cursorPath) {
  try {
    return JSON.parse(fs.readFileSync(cursorPath, "utf8"));
  } catch {
    return { channels: {} };
  }
}

function writeCursor(cursorPath, cursor) {
  try {
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    const tmp = `${cursorPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cursor, null, 2));
    fs.renameSync(tmp, cursorPath);
  } catch {
    /* best-effort */
  }
}

// Parse one .jsonl line into a minimal record we care about.
function parseLine(line) {
  const t = line.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// Worth indexing? Skip trivial/noise turns ("ok", "?", "}", a lone emoji,
// "/reset") — they pollute retrieval (especially under the TF fallback) without
// carrying recallable content. Require some real text: ≥12 chars and ≥2
// word-tokens.
function meaningfulBody(body) {
  const t = String(body || "").trim();
  if (t.length < 12) return false;
  if (/^\/(reset|new|start|help)\b/i.test(t)) return false;
  const words = t.match(/[\p{L}\p{N}]{2,}/gu) || [];
  return words.length >= 2;
}

// Build a chunk {id, source, channel, ts, tag, text} from a raw message record,
// or null if it shouldn't be indexed.
function chunkFromMessage(obj, channel) {
  const meta = obj.meta || {};
  const type = obj.type || meta.type;
  const body = String(obj.body || "").trim();
  if (!body || !meaningfulBody(body)) return null;
  const ts = obj.ts || "";
  const idBase = `${channel}:${ts}:${meta.message_id ?? meta.external_id ?? fnv1aHex(body)}`;
  if (type === "user" || type === "agent") {
    return {
      id: `msg:${idBase}`,
      source: "message",
      channel,
      ts,
      tag: type,
      text: body.slice(0, BODY_CAP),
    };
  }
  if (type === "tool") {
    const toolName = meta.tool_name || meta.tool || "tool";
    return {
      id: `tool:${idBase}`,
      source: "message",
      channel,
      ts,
      tag: `tool:${toolName}`,
      text: `[tool result: ${toolName}] ${body}`.slice(0, TOOL_CAP),
    };
  }
  return null;
}

// Collect new (not-yet-indexed) chunks from all channel message files.
function collectMessageChunks(store, cursor, messagesDir) {
  const fresh = [];
  const maxTsByChannel = {};
  if (!fs.existsSync(messagesDir)) return { fresh, maxTsByChannel };
  for (const channel of fs.readdirSync(messagesDir)) {
    const dir = path.join(messagesDir, channel);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const since = cursor.channels?.[channel] || "";
    let maxTs = since;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
      // Skip whole day files older than the cursor day.
      if (since && f.slice(0, 10) < since.slice(0, 10)) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(dir, f), "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        const obj = parseLine(line);
        if (!obj || !obj.ts) continue;
        if (since && obj.ts <= since) continue;
        if (obj.ts > maxTs) maxTs = obj.ts;
        const chunk = chunkFromMessage(obj, channel);
        if (chunk && !store.hasId(chunk.id)) fresh.push(chunk);
      }
    }
    if (maxTs) maxTsByChannel[channel] = maxTs;
  }
  return { fresh, maxTsByChannel };
}

// Collect memory.md entries as chunks (idempotent — keyed by content hash).
function collectMemoryChunks(store, memoryPath) {
  const fresh = [];
  let entries = [];
  try {
    const text = fs.readFileSync(memoryPath, "utf8");
    entries = parseSelfMemoryEntries(text);
  } catch {
    return fresh;
  }
  for (const e of entries) {
    const id = `memory:${e.date || "0"}:${fnv1aHex(e.text)}`;
    if (store.hasId(id)) continue;
    fresh.push({
      id,
      source: "memory",
      channel: e.channel || "memory",
      ts: e.ts || (e.date ? `${e.date}T00:00:00Z` : ""),
      tag: "memory",
      text: e.text.slice(0, BODY_CAP),
    });
  }
  return fresh;
}

// Split free-form markdown (project/agent memory — NOT the dated-notebook
// format) into meaningful blocks: blank-line separated, whitespace-collapsed,
// capped, and filtered so empty template sections ("## Identity\n- ") never
// pollute the store. Each block becomes one scoped chunk.
function chunkFreeMarkdown(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((block) => {
      // Drop pure-heading blocks (a "# Title" with no body under it) — they add
      // noise to retrieval. Keep blocks that have at least one non-heading line.
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.some((l) => !l.startsWith("#"))) return "";
      return block.replace(/\s+/g, " ").trim();
    })
    .filter((b) => meaningfulBody(b))
    .map((b) => b.slice(0, SCOPED_CAP));
}

// Per-agent memory lives at ~/.apx/projects/<projdir>/agents/<slug>/memory.md.
// Walkable straight off the filesystem — no registry needed. Scoped by channel
// "agent:<projdir>:<slug>" so retrieval never leaks between agents.
function collectAgentMemoryChunks(store, apxHome) {
  const fresh = [];
  const projectsRoot = path.join(apxHome, "projects");
  let projDirs;
  try {
    projDirs = fs.readdirSync(projectsRoot);
  } catch {
    return fresh;
  }
  for (const projDir of projDirs) {
    const agentsDir = path.join(projectsRoot, projDir, "agents");
    let slugs;
    try {
      slugs = fs.readdirSync(agentsDir);
    } catch {
      continue;
    }
    for (const slug of slugs) {
      const body = readIfExists(path.join(agentsDir, slug, "memory.md"));
      if (body == null) continue;
      const channel = `agent:${projDir}:${slug}`;
      for (const block of chunkFreeMarkdown(body)) {
        const id = `agentmem:${projDir}:${slug}:${fnv1aHex(block)}`;
        if (store.hasId(id)) continue;
        fresh.push({ id, source: "agent-memory", channel, ts: "", tag: "agent-memory", text: block });
      }
    }
  }
  return fresh;
}

// Project memory (.apc/memory.md) for every registered project. Needs the
// registry to map id → repo path. Scoped by channel "project:<id>".
function collectProjectMemoryChunks(store, projects) {
  const fresh = [];
  const list = typeof projects?.list === "function" ? projects.list() : Array.isArray(projects) ? projects : [];
  for (const entry of list) {
    const root = entry?.path;
    if (!root) continue; // the default project (id 0) has no repo root
    const body = readIfExists(apcMemoryFile(root));
    if (body == null) continue;
    const channel = `project:${entry.id}`;
    for (const block of chunkFreeMarkdown(body)) {
      const id = `projmem:${entry.id}:${fnv1aHex(block)}`;
      if (store.hasId(id)) continue;
      fresh.push({ id, source: "project-memory", channel, ts: "", tag: "project-memory", text: block });
    }
  }
  return fresh;
}

// Run one incremental indexing pass. Returns { indexed, backend }.
// `opts.embed` overrides embedding options (baseUrl/model/timeoutMs) for tests.
export async function indexNewMessages(store, opts = {}) {
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const cursorPath = opts.cursorPath || CURSOR_PATH;
  const messagesDir = opts.messagesDir || GLOBAL_MESSAGES_DIR;
  const memoryPath = opts.memoryPath || SELF_MEMORY_PATH;
  const embedOpts = opts.embed || {};
  const limit = opts.limit || 1000;

  const cursor = readCursor(cursorPath);
  cursor.channels = cursor.channels || {};

  // Embedder-consistency guard. Cosine only works within one embedder space, so
  // the whole store must share an embedder family ("ollama" vs "tf"). Probe the
  // currently-active embedder and reconcile:
  //   - upgrade (tf → ollama, i.e. Ollama came back): wipe + full re-index so
  //     the history is re-embedded in the better space.
  //   - downgrade (ollama → tf, i.e. Ollama went down): skip this pass entirely
  //     so we never pollute a good nomic store with TF rows.
  const probe = await embedOne("apx memory embedder probe", embedOpts);
  const family = probe.embedder.startsWith("ollama") ? "ollama" : "tf";
  const stored = cursor.embedder || null;
  if (stored && stored !== family && store.count() > 0) {
    if (family === "ollama") {
      try {
        store.clear?.();
      } catch {
        /* ignore */
      }
      cursor.channels = {};
      log(`memory: embedder ${stored}→ollama — full re-index`);
    } else {
      log("memory: Ollama unavailable — skipping index to keep embedder consistent");
      cursor.embedder = stored; // keep the good signature
      writeCursor(cursorPath, cursor);
      return { indexed: 0, backend: store.backend, skipped: "embedder-downgrade" };
    }
  }
  cursor.embedder = family;

  const { fresh: msgChunks, maxTsByChannel } = collectMessageChunks(store, cursor, messagesDir);
  const memChunks = collectMemoryChunks(store, memoryPath);
  // Scoped memory (Pieza 5): per-agent + per-project notebooks, tagged with a
  // scoped channel so retrieval can be isolated. Idempotent by content hash, so
  // re-derived every pass like memory.md (cheap, few blocks).
  const agentChunks = collectAgentMemoryChunks(store, opts.apxHome || APX_HOME);
  const projChunks = collectProjectMemoryChunks(store, opts.projects);
  let chunks = [...msgChunks, ...memChunks, ...agentChunks, ...projChunks];
  if (chunks.length === 0) return { indexed: 0, backend: store.backend };

  // Cap per-run work so a huge first index doesn't block; the rest is picked
  // up next pass (cursor only advances for what we actually embedded).
  let capped = false;
  if (chunks.length > limit) {
    chunks = chunks.slice(0, limit);
    capped = true;
  }

  const vecs = await embedBatch(
    chunks.map((c) => c.text),
    embedOpts
  );
  const rows = chunks.map((c, i) => ({
    ...c,
    embedder: vecs[i].embedder,
    dim: vecs[i].dim,
    vector: vecs[i].vector,
  }));
  const indexed = store.upsert(rows);

  // Only advance the per-channel cursor when we weren't capped (otherwise we'd
  // skip the chunks that didn't fit this pass).
  if (!capped) {
    for (const [channel, ts] of Object.entries(maxTsByChannel)) {
      cursor.channels[channel] = ts;
    }
    writeCursor(cursorPath, cursor);
  }

  log(`memory: indexed ${indexed} chunk(s)${capped ? " (capped, more next pass)" : ""}`);
  return { indexed, backend: store.backend, capped };
}
