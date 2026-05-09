// Messages store: filesystem source-of-truth + SQLite cache mirror.
//
// On disk (project-specific — runtime, a2a, exec):
//   ~/.apx/projects/<project-id>/messages/YYYY-MM-DD.jsonl
//
// On disk (global cross-project channels — telegram, direct, whatsapp, …):
//   ~/.apx/messages/<channel>/YYYY-MM-DD.jsonl
//
// Each line:
//   {"ts":"...","channel":"...","direction":"in|out","type":"user|agent|tool|system","author":"...","actor_id":"...","body":"...","meta":{...}}
//
// Why JSONL: same shape as Claude Code's ~/.claude/projects/<id>.jsonl.
// Streamable, structured, no markdown parsing fragility.
//
// Daemon writes go through `appendMessage` (project) or `appendGlobalMessage`
// (cross-project channel). `rebuildMessagesFromFs` is idempotent — wipes the
// SQL cache then reads every project day file in order.

import fs from "node:fs";
import path from "node:path";
import { GLOBAL_MESSAGES_DIR } from "./config.js";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function dayPathJsonl(projectRoot, ts) {
  const day = (ts || nowIso()).slice(0, 10);
  return path.join(projectRoot, "messages", `${day}.jsonl`);
}

function dayPathMd(projectRoot, ts) {
  const day = (ts || nowIso()).slice(0, 10);
  return path.join(projectRoot, "messages", `${day}.md`);
}

const VALID_MESSAGE_TYPES = new Set(["user", "agent", "tool", "system"]);

function normalizeMessageType(type) {
  return typeof type === "string" && VALID_MESSAGE_TYPES.has(type) ? type : null;
}

export function inferMessageType({ type, channel, direction, author, agent_slug, meta = {} } = {}) {
  const explicit = normalizeMessageType(type) || normalizeMessageType(meta.type) || normalizeMessageType(meta.actor_type);
  if (explicit) return explicit;
  if (channel === "a2a") return "agent";
  if (meta.tool || meta.tool_name) return "tool";
  if (author === "system") return "system";
  if (agent_slug && author && author !== "user" && !String(author).startsWith("@")) return "agent";
  if (direction === "in" && (author === "user" || String(author || "").startsWith("@"))) return "user";
  if (direction === "out") return "agent";
  return direction === "in" ? "user" : "agent";
}

function inferActorId({ type, actor_id, author, agent_slug, meta = {} } = {}) {
  if (actor_id) return actor_id;
  if (meta.actor_id) return meta.actor_id;
  if (type === "user") return meta.user_id ? String(meta.user_id) : (author || "user");
  if (type === "agent") return agent_slug || author || "agent";
  if (type === "tool") return meta.tool || meta.tool_name || author || "tool";
  if (type === "system") return author || "system";
  return author || null;
}

function messageMeta({ type, actor_id, agent_slug, session_id, external_id, meta = {} }) {
  return {
    ...meta,
    type,
    ...(actor_id ? { actor_id } : {}),
    ...(agent_slug ? { agent: agent_slug } : {}),
    ...(session_id ? { session_id } : {}),
    ...(external_id ? { external_id } : {}),
  };
}

export function appendMessageToFs({ projectRoot, channel, direction, type, actor_id, author, body, meta = {}, ts, agent_slug, session_id, external_id }) {
  ts = ts || nowIso();
  const file = dayPathJsonl(projectRoot, ts);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const msgType = inferMessageType({ type, channel, direction, author, agent_slug, meta });
  const msgActorId = inferActorId({ type: msgType, actor_id, author, agent_slug, meta });
  const fullMeta = messageMeta({ type: msgType, actor_id: msgActorId, agent_slug, session_id, external_id, meta });

  const record = {
    ts,
    channel,
    direction,
    type: msgType,
    author: author || null,
    ...(msgActorId ? { actor_id: msgActorId } : {}),
    body: body || "",
    ...(Object.keys(fullMeta).length ? { meta: fullMeta } : {}),
  };

  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return { ts, file };
}

// Insert a row into the SQL cache. Used by both appendMessage and rebuild.
export function insertMessageRow(db, m) {
  let agent_id = null;
  if (m.agent_slug) {
    const a = db.prepare("SELECT id FROM agents WHERE slug = ?").get(m.agent_slug);
    if (a) agent_id = a.id;
  }
  const type = inferMessageType(m);
  const actor_id = inferActorId({ ...m, type });
  const meta = messageMeta({
    type,
    actor_id,
    agent_slug: m.agent_slug,
    session_id: m.session_id,
    external_id: m.external_id,
    meta: m.meta || {},
  });
  return db
    .prepare(
      `INSERT INTO messages (agent_id, session_id, channel, direction, external_id, author, body, meta_json, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      agent_id,
      m.session_id || null,
      m.channel,
      m.direction,
      m.external_id || null,
      m.author || null,
      m.body || "",
      JSON.stringify(meta),
      m.ts
    );
}

// Single entry point used by everywhere the daemon writes a message.
export function appendMessage({ projectRoot, db, channel, direction, type, actor_id, author, body, meta = {}, ts, agent_slug, session_id, external_id }) {
  const written = appendMessageToFs({
    projectRoot,
    channel,
    direction,
    type,
    actor_id,
    author,
    body,
    meta,
    ts,
    agent_slug,
    session_id,
    external_id,
  });
  insertMessageRow(db, {
    channel,
    direction,
    type,
    actor_id,
    author,
    body,
    meta,
    ts: written.ts,
    agent_slug,
    session_id,
    external_id,
  });
  return written;
}

// Parse one .jsonl day file into [{...}, ...]
export function parseDayJsonl(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    if (!obj || typeof obj !== "object") continue;
    const meta = obj.meta || {};
    const agent_slug = obj.agent_slug || meta.agent;
    const type = inferMessageType({
      type: obj.type,
      channel: obj.channel,
      direction: obj.direction,
      author: obj.author,
      agent_slug,
      meta,
    });
    const actor_id = inferActorId({
      type,
      actor_id: obj.actor_id,
      author: obj.author,
      agent_slug,
      meta,
    });
    out.push({
      ts: obj.ts,
      channel: obj.channel,
      direction: obj.direction,
      type,
      author: obj.author,
      actor_id,
      body: obj.body || "",
      meta,
      agent_slug,
      session_id: meta.session_id ?? (typeof meta.apc_session_id === "number" ? meta.apc_session_id : null),
      external_id: meta.external_id,
    });
  }
  return out;
}

// Parse the legacy .md format (kept so rebuild still picks up files written
// by older versions of the daemon).
export function parseDayFile(text) {
  const out = [];
  const blocks = text.split(/\n(?=## \d{4}-\d{2}-\d{2}T)/);
  for (const block of blocks) {
    const m = block.match(/^## (\S+)\s+(\S+)\s+(in|out)\s+(.*?)\n([\s\S]*)$/);
    if (!m) continue;
    const ts = m[1];
    const channel = m[2];
    const direction = m[3];
    const author = m[4].trim();
    let body = m[5];
    let meta = {};
    const metaMatch = body.match(/<!--\s*meta:\s*(\{[\s\S]*?\})\s*-->/);
    if (metaMatch) {
      try { meta = JSON.parse(metaMatch[1]); } catch {}
      body = body.replace(metaMatch[0], "");
    }
    body = body.trim();
    const agent_slug = meta.agent;
    const type = inferMessageType({ channel, direction, author, agent_slug, meta });
    const actor_id = inferActorId({ type, author, agent_slug, meta });
    out.push({
      ts, channel, direction, author, body, meta,
      type,
      actor_id,
      agent_slug,
      session_id: meta.session_id ?? (typeof meta.apc_session_id === "number" ? meta.apc_session_id : null),
      external_id: meta.external_id,
    });
  }
  return out;
}

// Pull the recent conversation for a given Telegram chat_id from the messages
// table. Returns the messages in CHRONOLOGICAL order (oldest first), shaped
// for use as `previousMessages` to runSuperAgent / callEngine.
//
// Filters:
//   - channel = 'telegram'
//   - meta_json.chat_id matches chat_id
//   - ts within `max_age_hours` (default 24)
//   - up to `limit` rows, taking the most recent
//
// `direction='in'` becomes role:"user", `direction='out'` becomes
// role:"assistant". The current inbound (the one we're answering NOW) is
// expected to be excluded by the caller — usually by passing a `before` ts
// or by simply running this query BEFORE the inbound is logged.
export function getRecentTelegramTurns(
  db,
  { chat_id, limit = 12, max_age_hours = 24 }
) {
  if (!chat_id) return [];
  const cutoff = new Date(Date.now() - max_age_hours * 3600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const rows = db
    .prepare(
      `SELECT direction, body, meta_json, ts FROM messages
       WHERE channel = 'telegram'
         AND ts >= ?
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(cutoff, limit * 4) // overshoot, then filter by chat_id in JS
    .filter((r) => {
      try {
        const meta = JSON.parse(r.meta_json || "{}");
        return String(meta.chat_id ?? "") === String(chat_id);
      } catch {
        return false;
      }
    })
    .slice(0, limit);

  // We pulled DESC; reverse to get oldest-first for the model.
  return rows.reverse().map((r) => {
    const role = r.direction === "in" ? "user" : "assistant";
    let content = r.body;
    if (role === "assistant") content = sanitizeAssistantForContext(content);
    return { role, content };
  });
}

// Aggressively redact assistant turns before sending them as context. The
// problem we're solving: when the model sees its own past answer with
// concrete factual claims (agent names, model ids, paths, MCPs), it tends
// to "amplify" them in the next turn — composing a plausible-looking new
// answer that mixes fragments of the old one with hallucinations. The
// failure observed with qwen2.5:14b was:
//
//   prev assistant: "agente sandbox con modelo ollama:llama3.2:3b"
//   user: "y en el otro proyecto qué agente tiene?"
//   assistant (alucinated): "agente assistant con modelo ollama:llama3.2:3b"
//                           (sofia exists, not "assistant", and her model is
//                            claude-haiku-4-5, not the carry-over from above)
//
// Solution: replace any assistant turn that *looks* like it contains data
// with a generic "I answered" placeholder. The model loses the cache to
// copy from but keeps enough hint to track the conversation flow.
function sanitizeAssistantForContext(content) {
  if (!content) return "";
  // Heuristics — if any of these match, the turn likely contains facts
  // the model should re-derive from tools rather than parrot from cache.
  const FACTUAL_PATTERNS = [
    /\b(claude-|gpt-|gemini|llama|qwen|sonnet|haiku|opus|deepseek|kimi|mistral|gemma)\b/i,
    /\b(ollama:|anthropic:|openai:|gemini:)/i,
    /\b(role|rol|model|modelo|skills?|habilidades?)\s*[:=]/i,
    /^- \w+/m,             // bulleted list
    /\*\*\w+\*\*/,         // bold names
    /\.(jsonl|md|json|sqlite|db|yaml|toml)\b/i,
    /\/Users\/|\/Volumes\/|\/home\//i,
  ];
  for (const re of FACTUAL_PATTERNS) {
    if (re.test(content)) {
      return "(I answered with data here. Re-call the tool to get the current values — do not paraphrase from memory.)";
    }
  }
  // Otherwise it's conversational small-talk; keep up to 200 chars.
  if (content.length > 200) {
    return content.slice(0, 200).replace(/\s+/g, " ").trim() + "…";
  }
  return content;
}

// ---------------------------------------------------------------------------
// File-based project message queries (no SQL required)
// ---------------------------------------------------------------------------

export function readProjectMessages(projectRoot, { channel, agent_slug, since, limit = 100 } = {}) {
  const dir = path.join(projectRoot, "messages");
  if (!fs.existsSync(dir)) return [];
  const all = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    const text = fs.readFileSync(full, "utf8");
    let msgs = [];
    if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) msgs = parseDayJsonl(text);
    else if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) msgs = parseDayFile(text);
    for (const m of msgs) {
      if (channel && m.channel !== channel) continue;
      if (agent_slug && m.agent_slug !== agent_slug) continue;
      if (since && m.ts < since) continue;
      all.push(m);
    }
  }
  all.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  return all.slice(0, Math.min(limit, 1000));
}

export function searchProjectMessages(projectRoot, query, limit = 50) {
  if (!query) return [];
  const q = query.toLowerCase();
  const dir = path.join(projectRoot, "messages");
  if (!fs.existsSync(dir)) return [];
  const all = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    const text = fs.readFileSync(full, "utf8");
    let msgs = [];
    if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) msgs = parseDayJsonl(text);
    else if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) msgs = parseDayFile(text);
    for (const m of msgs) {
      if ((m.body || "").toLowerCase().includes(q)) all.push(m);
    }
  }
  all.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  return all.slice(0, Math.min(limit, 500));
}

// File-based Telegram turn history: reads from ~/.apx/messages/telegram/ JSONL.
// Pass _globalMessagesDir to override the default dir (useful in tests).
export function getRecentTelegramTurnsFromFs({
  chat_id,
  limit = 12,
  max_age_hours = 24,
  _globalMessagesDir,
} = {}) {
  if (!chat_id) return [];
  const cutoff = new Date(Date.now() - max_age_hours * 3600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const base = _globalMessagesDir || GLOBAL_MESSAGES_DIR;
  const dir = path.join(base, "telegram");
  if (!fs.existsSync(dir)) return [];
  const all = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of parseDayJsonl(text)) {
      if (m.ts < cutoff) continue;
      all.push(m);
    }
  }
  all.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  const filtered = all
    .filter((m) => String(m.meta?.chat_id ?? "") === String(chat_id))
    .slice(-limit);
  return filtered.map((m) => {
    const role = m.direction === "in" ? "user" : "assistant";
    let content = m.body;
    if (role === "assistant") content = sanitizeAssistantForContext(content);
    return { role, content };
  });
}

// ---------------------------------------------------------------------------
// Global message store  (~/.apx/messages/<channel>/YYYY-MM-DD.jsonl)
// ---------------------------------------------------------------------------

// Write a message to the global channel store.  No SQL cache — JSONL only.
export function appendGlobalMessage({ channel, direction, type, actor_id, author, body, meta = {}, ts, agent_slug, external_id }) {
  ts = ts || nowIso();
  const dir = path.join(GLOBAL_MESSAGES_DIR, channel);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ts.slice(0, 10)}.jsonl`);
  const msgType = inferMessageType({ type, channel, direction, author, agent_slug, meta });
  const msgActorId = inferActorId({ type: msgType, actor_id, author, agent_slug, meta });
  const fullMeta = messageMeta({ type: msgType, actor_id: msgActorId, agent_slug, external_id, meta });
  const record = {
    ts,
    channel,
    direction,
    type: msgType,
    author: author || null,
    ...(msgActorId ? { actor_id: msgActorId } : {}),
    body: body || "",
    ...(Object.keys(fullMeta).length ? { meta: fullMeta } : {}),
  };
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return { ts, file };
}

// Read recent global channel messages from disk.
// Returns parsed records sorted oldest-first.
export function readGlobalMessages({ channel, limit = 100, since } = {}) {
  const channels = channel
    ? [channel]
    : (fs.existsSync(GLOBAL_MESSAGES_DIR) ? fs.readdirSync(GLOBAL_MESSAGES_DIR).filter((f) => {
        const full = path.join(GLOBAL_MESSAGES_DIR, f);
        return fs.statSync(full).isDirectory();
      }) : []);

  const all = [];
  for (const ch of channels) {
    const dir = path.join(GLOBAL_MESSAGES_DIR, ch);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      for (const m of parseDayJsonl(text)) {
        if (since && m.ts < since) continue;
        all.push({ ...m, channel: ch });
      }
    }
  }
  all.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return all.slice(-limit);
}

// Wipe the cache and re-populate from APX project messages. Reads BOTH `.jsonl`
// (current format) and `.md` (legacy). Called by rebuild.
export function rebuildMessagesFromFs(db, projectRoot) {
  const dir = path.join(projectRoot, "messages");
  if (!fs.existsSync(dir)) return { count: 0 };
  db.prepare("DELETE FROM messages").run();

  // Collect every line from every .jsonl + .md, parse, sort by ts so the
  // SQL row ids end up in the right order.
  const all = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    const text = fs.readFileSync(full, "utf8");
    if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) {
      all.push(...parseDayJsonl(text));
    } else if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) {
      all.push(...parseDayFile(text));
    }
  }
  all.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));

  const tx = db.transaction(() => {
    for (const m of all) insertMessageRow(db, m);
  });
  tx();
  return { count: all.length };
}
