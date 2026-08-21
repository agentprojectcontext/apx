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
import { GLOBAL_MESSAGES_DIR } from "../config/index.js";
import { CHANNELS } from "../constants/channels.js";
import { SUPERAGENT_ACTOR_ID } from "../constants/actors.js";

import { nowIso } from "../util/time.js";
import { emitMessageEvent } from "../events/bus.js";

function dayPathJsonl(projectRoot, ts) {
  const day = (ts || nowIso()).slice(0, 10);
  return path.join(projectRoot, "messages", `${day}.jsonl`);
}

// `compact` is a progressive-compaction summary record (Pieza 3): a dense
// recap of older turns, stored inline in the channel JSONL so the reader can
// prepend it as a [RESUMEN COMPACTADO] system turn instead of replaying the
// raw history it covers.
const VALID_MESSAGE_TYPES = new Set(["user", "agent", "tool", "system", "compact"]);

// Render class (`type`) stays a 4-value enum the UI branches on. `actor_kind`
// is a finer discriminator stored in meta: who/what actually produced the turn.
//   superagent — the APX daemon-level agent (persona from identity.json)
//   agent      — a project agent (its own slug/persona, may run on any engine)
//   engine     — a raw external engine reply with no project-agent persona
//   user / tool / system — mirror the render class
const VALID_ACTOR_KINDS = new Set(["superagent", "agent", "engine", "user", "tool", "system", "compact"]);

function normalizeMessageType(type) {
  return typeof type === "string" && VALID_MESSAGE_TYPES.has(type) ? type : null;
}

function normalizeActorKind(kind) {
  return typeof kind === "string" && VALID_ACTOR_KINDS.has(kind) ? kind : null;
}

// Best-effort classification of the actor when not given explicitly. Legacy
// records (and most call sites) don't set actor_kind, so this keeps history
// queryable: a `type:"agent"` turn whose actor_id is the stable super-agent id
// is a "superagent"; any other agent turn is a project "agent".
function inferActorKind({ actor_kind, type, actor_id, meta = {} } = {}) {
  const explicit = normalizeActorKind(actor_kind) || normalizeActorKind(meta.actor_kind);
  if (explicit) return explicit;
  if (type === "compact") return "compact";
  if (type === "user" || type === "tool" || type === "system") return type;
  if (type === "agent") return actor_id === SUPERAGENT_ACTOR_ID ? "superagent" : "agent";
  return null;
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
  if (type === "compact") return "compact";
  return author || null;
}

function messageMeta({ type, actor_id, actor_kind, agent_slug, session_id, external_id, meta = {} }) {
  return {
    ...meta,
    type,
    ...(actor_id ? { actor_id } : {}),
    ...(actor_kind ? { actor_kind } : {}),
    ...(agent_slug ? { agent: agent_slug } : {}),
    ...(session_id ? { session_id } : {}),
    ...(external_id ? { external_id } : {}),
  };
}

export function appendMessageToFs({ projectRoot, channel, direction, type, actor_id, actor_kind, author, body, meta = {}, ts, agent_slug, session_id, external_id }) {
  ts = ts || nowIso();
  const file = dayPathJsonl(projectRoot, ts);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const msgType = inferMessageType({ type, channel, direction, author, agent_slug, meta });
  const msgActorId = inferActorId({ type: msgType, actor_id, author, agent_slug, meta });
  const msgActorKind = inferActorKind({ actor_kind, type: msgType, actor_id: msgActorId, meta });
  const fullMeta = messageMeta({ type: msgType, actor_id: msgActorId, actor_kind: msgActorKind, agent_slug, session_id, external_id, meta });

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
  // Announce it. Both project writers land here — `appendMessage` wraps this
  // function — so one emit covers the whole project funnel. The storage path
  // and not a project id: core has no registry to resolve one, and the daemon
  // that subscribes does. See core/events/bus.js.
  emitMessageEvent({
    scope: "project",
    project_root: projectRoot,
    channel,
    thread: ts.slice(0, 10),
    agent_slug: agent_slug || null,
    direction,
    type: msgType,
    ts,
  });
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
  const actor_kind = inferActorKind({ actor_kind: m.actor_kind, type, actor_id, meta: m.meta || {} });
  const meta = messageMeta({
    type,
    actor_id,
    actor_kind,
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
export function appendMessage({ projectRoot, db, channel, direction, type, actor_id, actor_kind, author, body, meta = {}, ts, agent_slug, session_id, external_id }) {
  const written = appendMessageToFs({
    projectRoot,
    channel,
    direction,
    type,
    actor_id,
    actor_kind,
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
    actor_kind,
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
    const actor_kind = inferActorKind({ actor_kind: obj.actor_kind, type, actor_id, meta });
    out.push({
      ts: obj.ts,
      channel: obj.channel,
      direction: obj.direction,
      type,
      author: obj.author,
      actor_id,
      actor_kind,
      body: obj.body || "",
      meta,
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
//   prev assistant: "sandbox agent with model ollama:llama3.2:3b"
//   user: "and what agent does the other project have?"
//   assistant (hallucinated): "assistant agent with model ollama:llama3.2:3b"
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
      // Third person, and visibly an annotation ABOUT the turn rather than the
      // turn itself. Written in the first person ("I answered with data here…")
      // this read as something the assistant had said, and after a few of them
      // in a row the model copied the sentence and sent it to the user as its
      // reply. History the model can mistake for its own voice gets imitated.
      return "[omitted: this turn contained data that may be stale — call the tool again instead of repeating it]";
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
    for (const m of msgs) {
      if ((m.body || "").toLowerCase().includes(q)) all.push(m);
    }
  }
  all.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  return all.slice(0, Math.min(limit, 500));
}

// ── A2A "group chats" ────────────────────────────────────────────────────────
// Agent-to-agent exchanges are project-scoped (they live in the project ledger,
// not the global channel dir), so listGlobalThreads never sees them. But they
// are NOT one agent's conversation either — an a2a exchange is a thing between
// two agents (claude · roby). We surface it as its own thread, keyed by the
// PAIR of participants, so the web sidebar's "Agent ↔ Agent" group fills with a
// group chat per pair instead of hiding inside either agent's session.

// The two participants of an a2a row. `agent_slug` is the ledger owner (the
// `from` or `to` the row was written under); `meta.from`/`meta.to` names the
// counterpart; `author` is who actually spoke. Any two distinct of these are
// the pair.
function a2aPair(m) {
  const set = new Set([m.agent_slug, m.author, m.meta?.from, m.meta?.to].filter(Boolean));
  return [...set].sort();
}
function a2aPairId(pair) {
  return pair.join("~");
}
// `apx send … --deliver` logs each utterance twice — once under `from`, once
// under `to`. Collapse to one line per (who, when, what) so the thread reads as
// a conversation, not a doubled transcript.
function dedupA2A(msgs) {
  const best = new Map();
  for (const m of msgs) {
    const k = `${m.ts}|${m.author}|${(m.body || "").slice(0, 120)}`;
    const cur = best.get(k);
    // Keep the copy logged under the SPEAKER's own ledger (agent_slug === author):
    // that is the one carrying the turn's usage/model/reply_to, not the mirror
    // written under the other peer.
    if (!cur || (m.agent_slug === m.author && cur.agent_slug !== cur.author)) best.set(k, m);
  }
  return [...best.values()];
}

/** One thread entry per a2a participant-pair in this project. Shaped like a
 *  listGlobalThreads() row so the web sidebar renders it in the a2a group,
 *  plus `participants` for the double-avatar face. */
export function listProjectA2AThreads(projectRoot) {
  const msgs = readProjectMessages(projectRoot, { channel: "a2a", limit: 1000 });
  const byPair = new Map();
  for (const m of msgs) {
    const pair = a2aPair(m);
    if (pair.length < 2) continue;
    const id = a2aPairId(pair);
    const g = byPair.get(id) || { pair, msgs: [] };
    g.msgs.push(m);
    byPair.set(id, g);
  }
  const out = [];
  for (const [id, g] of byPair) {
    const uniq = dedupA2A(g.msgs).sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    if (!uniq.length) continue;
    const last = uniq[uniq.length - 1];
    // Who asked for this exchange — set when an agent relays on a person's behalf
    // (`apx send --for <who>`). Lets the UI show "a pedido de X" and connect a
    // a2a the user triggered back to them, instead of it floating detached.
    const requested_by = g.msgs.map((m) => m.meta?.requested_by).find(Boolean) || null;
    out.push({
      id,
      channel: "a2a",
      title: g.pair.join(" · "),
      participants: g.pair,
      ...(requested_by ? { requested_by } : {}),
      messages: uniq.length,
      started_at: uniq[0].ts,
      last_ts: last.ts,
      preview: `${last.author}: ${(last.body || "").replace(/\s+/g, " ").trim()}`.slice(0, 140),
    });
  }
  out.sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
  return out;
}

/** One a2a thread (by pair id) shaped for the web chat viewer: every utterance
 *  as an agent turn carrying its author, so the viewer can attribute each
 *  bubble to whichever agent spoke. Null when the pair has no messages. */
export function readProjectA2AThread(projectRoot, id) {
  const want = String(id || "");
  const msgs = readProjectMessages(projectRoot, { channel: "a2a", limit: 1000 })
    .filter((m) => a2aPairId(a2aPair(m)) === want);
  const uniq = dedupA2A(msgs).sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  if (!uniq.length) return null;
  return {
    id: want,
    channel: "a2a",
    participants: want.split("~"),
    // Shaped through the ONE ledger interpreter (shapeLedgerMessage), same as
    // every other channel — so model, token usage, tool summary and attribution
    // all survive. a2a double-logs under both peers, so normalise agent_slug to
    // the SPEAKER (m.author) first; the shaper does the rest.
    messages: uniq.map((m) =>
      shapeLedgerMessage({ ...m, type: "agent", agent_slug: m.author, actor_kind: m.actor_kind || "agent" }),
    ),
  };
}

const TOOL_CONTEXT_CAP = 700; // chars of a tool result kept in model context
const TOOL_CALL_CAP = 160;    // chars of the invocation that introduces it

// What a tool record actually returned. The record stores the invocation in
// `body` ("run_shell({\"command\":…})") and the OUTCOME in `meta.result` —
// this used to read `body`, so the rolling history replayed the agent's own
// commands and never a single result. A turn could re-read the shell script it
// wrote an hour ago and still not know what the shell said, which is what made
// long Telegram threads feel amnesiac: the model kept re-deriving facts it had
// already fetched. Prefer the result; fall back to the invocation only when a
// record has none (older records, or a tool that returns undefined).
function renderToolResultBody(m) {
  let r = m.meta?.result;
  if (r === undefined || r === null || r === "") return "";
  // Some writers store the result already serialized. Re-parse so the shell
  // envelope below still gets unwrapped instead of being replayed as escaped
  // JSON, which spends the whole budget on backslashes.
  if (typeof r === "string") {
    const t = r.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        r = JSON.parse(t);
      } catch {
        // Records written before the trace kept its shape are truncated JSON
        // text and will never parse. Dig the stdout out by hand rather than
        // replaying a wall of backslashes.
        const cut = t.match(/"stdout"\s*:\s*"((?:[^"\\]|\\.)*)/);
        if (!cut) return t;
        try { return JSON.parse(`"${cut[1]}"`); } catch { return cut[1]; }
      }
    } else {
      return r;
    }
  }
  // Shell-shaped results are mostly envelope; the stdout is the information.
  if (typeof r === "object" && !Array.isArray(r)) {
    const parts = [];
    if (typeof r.stdout === "string" && r.stdout.trim()) parts.push(r.stdout.trim());
    if (typeof r.stderr === "string" && r.stderr.trim()) parts.push(`stderr: ${r.stderr.trim()}`);
    if (r.error) parts.push(`error: ${typeof r.error === "string" ? r.error : JSON.stringify(r.error)}`);
    if (parts.length) {
      const code = r.exit_code;
      return (Number.isFinite(code) && code !== 0 ? `exit=${code} ` : "") + parts.join(" | ");
    }
  }
  try {
    return JSON.stringify(r);
  } catch {
    return String(r);
  }
}

// Truncated, prefixed rendering of a tool record for model context (Pieza 3).
// Shape: `[tool <name>] <short invocation> → <result>`. The invocation is kept
// (short) because a result with no question attached is unreadable — "1247"
// means nothing without "wc -l on X". The result gets the bulk of the budget.
function renderToolResult(m) {
  const name = m.meta?.tool_name || m.meta?.tool || m.actor_id || "tool";
  const flat = (s) => String(s || "").replace(/\s+/g, " ").trim();
  // `body` is "<name>(<args>)" and the name is already in the prefix — keep
  // only the arguments so the cap buys context, not a repeated tool name.
  const raw = flat(m.body);
  const call = (raw.startsWith(`${name}(`) ? raw.slice(name.length + 1, -1) : raw).slice(0, TOOL_CALL_CAP);
  const result = flat(renderToolResultBody(m));
  if (!result) return `[tool ${name}] ${call}`.slice(0, TOOL_CONTEXT_CAP);
  const head = `[tool ${name}] ${call} → `;
  return head + result.slice(0, Math.max(120, TOOL_CONTEXT_CAP - head.length));
}

// Collapse consecutive same-role entries into one message. Keeps the model
// context clean and side-steps engines (Anthropic) that dislike consecutive
// same-role turns once tool results land on the assistant side.
function coalesceTurns(turns) {
  const out = [];
  for (const t of turns) {
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role) {
      prev.content = `${prev.content}\n${t.content}`.trim();
    } else {
      out.push({ role: t.role, content: t.content });
    }
  }
  return out;
}

// File-based channel turn history (Pieza 3). Reads ~/.apx/messages/<channel>/
// JSONL and shapes it for use as `previousMessages`:
//   - the latest `compact` record (if any) is prepended as a role:"system"
//     turn "[RESUMEN COMPACTADO turnos a-b]: …"; the raw turns it covers are
//     dropped (they live in the summary now)
//   - tool records are INCLUDED as "[tool <name>] <call> → <result>", the
//     RESULT truncated to fit TOOL_CONTEXT_CAP (kept on the assistant side)
//   - the most recent `keepRecent` conversational turns are kept verbatim
//   - consecutive same-role turns are coalesced
//
// Pass _globalMessagesDir to override the default dir (useful in tests).
export function getRecentChannelTurnsFromFs({
  channel = "telegram",
  chat_id,
  // Back-compat: `limit` (if given) is treated as the verbatim-turn budget.
  limit,
  keepRecent = 40,
  max_age_hours = 24,
  includeTools = true,
  _globalMessagesDir,
} = {}) {
  if (!chat_id) return [];
  const keep = Number.isFinite(limit) ? limit : keepRecent;
  const cutoff = new Date(Date.now() - max_age_hours * 3600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const base = _globalMessagesDir || GLOBAL_MESSAGES_DIR;
  const dir = path.join(base, channel);
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
  const mine = all.filter((m) => String(m.meta?.chat_id ?? "") === String(chat_id));

  // Latest compact record wins; everything it covers is replaced by its summary.
  let compact = null;
  for (const m of mine) if (m.type === "compact") compact = m;
  const coverUntil = compact ? compact.meta?.covers_until_ts || compact.ts : "";

  const eligible = mine.filter(
    (m) =>
      (m.type === "user" || m.type === "agent" || (includeTools && m.type === "tool")) &&
      (!coverUntil || m.ts > coverUntil)
  );

  // Keep the last `keep` conversational (user/agent) turns plus any tool
  // results interleaved among them.
  const kept = [];
  let realCount = 0;
  for (let i = eligible.length - 1; i >= 0; i--) {
    const m = eligible[i];
    kept.push(m);
    if (m.type === "user" || m.type === "agent") realCount++;
    if (realCount >= keep) break;
  }
  kept.reverse();

  const turns = [];
  if (compact && String(compact.body || "").trim()) {
    const range = compact.meta?.range;
    const label = Array.isArray(range)
      ? `turnos ${range[0]}-${range[1]}`
      : `${compact.meta?.count || ""} turnos previos`.trim();
    turns.push({
      role: "system",
      content: `[RESUMEN COMPACTADO ${label}]:\n${String(compact.body).trim()}`,
    });
  }
  for (const m of kept) {
    if (m.type === "tool") {
      turns.push({ role: "assistant", content: renderToolResult(m) });
    } else {
      const role = m.type === "user" ? "user" : "assistant";
      let content = m.body;
      if (role === "assistant") content = sanitizeAssistantForContext(content);
      turns.push({ role, content });
    }
  }
  return coalesceTurns(turns);
}

// Telegram-specific wrapper kept for back-compat with existing call sites.
export function getRecentTelegramTurnsFromFs(opts = {}) {
  return getRecentChannelTurnsFromFs({ ...opts, channel: CHANNELS.TELEGRAM });
}

// ---------------------------------------------------------------------------
// Global message store  (~/.apx/messages/<channel>/YYYY-MM-DD.jsonl)
// ---------------------------------------------------------------------------

// Write a message to the global channel store.  No SQL cache — JSONL only.
export function appendGlobalMessage({ channel, direction, type, actor_id, actor_kind, author, body, meta = {}, ts, agent_slug, external_id }) {
  ts = ts || nowIso();
  const dir = path.join(GLOBAL_MESSAGES_DIR, channel);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ts.slice(0, 10)}.jsonl`);
  const msgType = inferMessageType({ type, channel, direction, author, agent_slug, meta });
  const msgActorId = inferActorId({ type: msgType, actor_id, author, agent_slug, meta });
  const msgActorKind = inferActorKind({ actor_kind, type: msgType, actor_id: msgActorId, meta });
  const fullMeta = messageMeta({ type: msgType, actor_id: msgActorId, actor_kind: msgActorKind, agent_slug, external_id, meta });
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
  // Announce it: this is the funnel every channel writes through — Telegram in
  // and out, desktop, the web's own turns — so a surface subscribed to the bus
  // sees a conversation move no matter which device produced the turn.
  // `thread` is the day file's id because that is how a channel thread is
  // addressed everywhere else (readGlobalThread, the inbox row, the URL).
  emitMessageEvent({
    scope: "global",
    channel,
    thread: ts.slice(0, 10),
    project_id: fullMeta.project_id ?? null,
    agent_slug: agent_slug || null,
    direction,
    type: msgType,
    ts,
  });
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

// ---------------------------------------------------------------------------
// Global channel threads (super-agent chats surfaced in the web Chats sidebar)
// ---------------------------------------------------------------------------
// The global ledger is the source of truth for every super-agent turn outside
// exec (telegram, web quick-chat, desktop, deck …). A "thread" is one
// channel+day JSONL file — the same granularity the context window reads.

const CHANNEL_NAME_RE = /^[a-z0-9_-]+$/i;

// The workspace an unstamped row belongs to. Telegram, desktop and deck each
// write one daemon-wide channel with no project of their own, and so does every
// row written before web turns started stamping one. Those chats are the default
// workspace's, not every project's: calling them unowned — visible from every
// project — is what put all ninety-odd Telegram threads in the sidebar of
// projects none of them happened in.
const DEFAULT_THREAD_PROJECT = "0";

// Which project a ledger row was written from, when the writer knew. Web turns
// stamp it (api/super-agent.js), because the web panel is the one surface where
// the same channel is used from several projects.
function rowProject(r) {
  const v = r?.meta?.project_id;
  return v === undefined || v === null || v === "" ? null : String(v);
}

// Whether a row belongs in `want`'s view of the ledger: a stamped row only in
// its own project, an unstamped one in the default workspace.
function rowBelongsTo(r, want) {
  return (rowProject(r) ?? DEFAULT_THREAD_PROJECT) === want;
}

// Rows belonging to `project`. `undefined`/null means no filtering at all — the
// cross-project shape the agent inbox and rebuild read.
function keepForProject(rows, project) {
  if (project === undefined || project === null || project === "") return rows;
  const want = String(project);
  return rows.filter((r) => rowBelongsTo(r, want));
}

// List every non-empty channel+day thread, newest-last-activity first.
// `project` narrows to the chats that happened in that project (see
// keepForProject) — the web sidebar passes it so each project lists its own
// conversations, with the channel groups inside it left intact.
// ── Thread overrides ────────────────────────────────────────────────────────
// A channel thread has no file of its own to carry metadata: it IS a day of a
// channel's ledger, and the ledger rows are the record of what was said — not a
// place to hang what the reader decided to call it. So the two decisions a
// reader can make about a thread, its name and whether it has been put away,
// live in one small index beside the ledger. Nothing here changes a single
// message, and losing this file loses only the names.
const THREAD_META_FILE = ".threads.json";

function threadMetaPath(base) {
  return path.join(base, THREAD_META_FILE);
}

function readThreadMeta(base) {
  try {
    return JSON.parse(fs.readFileSync(threadMetaPath(base), "utf8")) || {};
  } catch {
    return {};
  }
}

/** Key one thread. Channel and date both, because the same date exists in every
 *  channel and they are different conversations. */
function threadKey(channel, date) {
  return `${channel}/${date}`;
}

/**
 * Name a thread, or put it away. `title: ""` drops the override and the
 * derived title (the first thing said) comes back.
 */
export function setGlobalThreadMeta({ channel, date, title, archived, _globalMessagesDir } = {}) {
  if (!CHANNEL_NAME_RE.test(String(channel || ""))) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return false;
  const base = _globalMessagesDir || GLOBAL_MESSAGES_DIR;
  if (!fs.existsSync(base)) return false;
  const all = readThreadMeta(base);
  const key = threadKey(channel, date);
  const entry = { ...(all[key] || {}) };
  if (title !== undefined) {
    const clean = String(title).replace(/\s+/g, " ").trim().slice(0, 200);
    if (clean) entry.title = clean;
    else delete entry.title;
  }
  if (archived !== undefined) {
    if (archived) entry.archived = true;
    else delete entry.archived;
  }
  if (Object.keys(entry).length) all[key] = entry;
  else delete all[key];
  fs.writeFileSync(threadMetaPath(base), JSON.stringify(all, null, 2) + "\n");
  return true;
}

export function listGlobalThreads({ channels, project, includeArchived = false, _globalMessagesDir } = {}) {
  const base = _globalMessagesDir || GLOBAL_MESSAGES_DIR;
  if (!fs.existsSync(base)) return [];
  const chans = (channels && channels.length
    ? channels
    : fs.readdirSync(base).filter((f) => {
        try { return fs.statSync(path.join(base, f)).isDirectory(); } catch { return false; }
      })
  ).filter((c) => CHANNEL_NAME_RE.test(c));

  const meta = readThreadMeta(base);
  const out = [];
  for (const ch of chans) {
    const dir = path.join(base, ch);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!m) continue;
      const msgs = keepForProject(
        parseDayJsonl(fs.readFileSync(path.join(dir, f), "utf8")).filter(
          (r) => r.type === "user" || r.type === "agent"
        ),
        project,
      );
      if (!msgs.length) continue;
      const over = meta[threadKey(ch, m[1])] || {};
      if (over.archived && !includeArchived) continue;
      const firstUser = msgs.find((r) => r.type === "user");
      const derived = String((firstUser || msgs[0]).body || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      out.push({
        id: m[1],
        channel: ch,
        // What the reader called it wins over the first thing that was said.
        title: over.title || derived || `${ch} · ${m[1]}`,
        archived: over.archived || undefined,
        messages: msgs.length,
        started_at: msgs[0].ts,
        last_ts: msgs[msgs.length - 1].ts,
      });
    }
  }
  out.sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
  return out;
}

// The attachment a stored turn carries, shaped for a viewer.
//
// The bytes live in ~/.apx/media and the turn records where: without this the
// thread showed only the text marker the agent was given ("[document received:
// … saved to /Users/…]"), which says nothing to the person who sent the file.
//
// Records written since dispatch merged the media row carry `media_kind`;
// older ones predate it, so the kind is inferred from the metadata that IS
// there — a transcription backend means a voice note, pixel dimensions mean a
// photo, anything else with a file behind it is a plain file.
//
// What marks a row as carrying a file is the file: a Telegram `file_id` or a
// `local_path`. Requiring the id would have made every web upload — which has
// no Telegram anything — read back as a plain typed message.
export function mediaFromMeta(meta) {
  if (!meta || (!meta.file_id && !meta.local_path)) return null;
  const kind = Array.isArray(meta.media_kind) ? meta.media_kind[0] : meta.media_kind;
  const resolved =
    kind ||
    (meta.transcription_backend !== undefined ? "audio" : meta.width ? "photo" : "file");
  return {
    kind: resolved,
    // null when the download failed: the turn still records what arrived, and
    // the viewer says the copy is missing instead of offering a dead player.
    path: meta.local_path || null,
    name: meta.file_name || (meta.local_path ? path.basename(meta.local_path) : null),
    mime: meta.mime_type || null,
    size: meta.file_size ?? null,
    duration: meta.duration ?? null,
  };
}

// Read one channel+day thread shaped for the web chat viewer:
// { id, channel, messages: [{ role, content, ts, … }] } — or null when missing.
// Tool records are INCLUDED (role:"tool" with structured tool/args/result from
// meta) so the web viewer can render tool executions the same way the live
// stream does. They're persisted by every channel (e.g. telegram reply.js) but
// never sent to the channel itself; dropping them here is what made Telegram
// tool calls invisible in the web chat even though they were on disk.
//
// Assistant rows also carry their ATTRIBUTION — which agent answered
// (agent/agent_name/actor_kind) and on which model, plus the turn's token
// usage. All of it is already on disk in `meta`; dropping it here is what made
// a reloaded thread render "0 tok" with no model, even though the live stream
// showed both.
// THE ONE INTERPRETER FOR LEDGER ROWS → viewer messages.
//
// Every channel's history is read back through THIS function: telegram, web,
// desktop, a2a — all of them. It is what carries a turn's attribution (who
// answered, its actor_kind), its MODEL, its token USAGE, its tool summary and
// reasoning from the raw JSONL row out to the thread viewer. A channel that
// shapes its own rows by hand WILL drop these (that is exactly how a2a first
// shipped showing "0 tok" and no model). So: if you add a new channel, read it
// back with shapeLedgerMessage — never re-map rows inline. The only thing a
// caller does first is normalise the raw row (e.g. a2a sets agent_slug to the
// speaker before shaping, because it double-logs under both peers).
export function shapeLedgerMessage(r) {
  if (r.type === "tool") {
    return {
      role: "tool",
      content: r.body || "",
      ts: r.ts,
      tool: r.meta?.tool || r.meta?.tool_name || r.actor_id || "tool",
      args: r.meta?.args,
      result: r.meta?.result,
    };
  }
  if (r.type === "user") {
    const media = mediaFromMeta(r.meta);
    return { role: "user", content: r.body || "", ts: r.ts, ...(media ? { media } : {}) };
  }
  const usage = r.meta?.usage;
  // Images the agent attached to its own message (attach_media → routine
  // delivery). Stored on the row meta the same way an inbound upload is, so the
  // thread viewer can render an agent-sent photo, not only a user-sent one.
  const media = mediaFromMeta(r.meta);
  return {
    role: "assistant",
    content: r.body || "",
    ts: r.ts,
    ...(media ? { media } : {}),
    ...(Array.isArray(r.meta?.media) && r.meta.media.length ? { media_list: r.meta.media } : {}),
    // Stable id of who answered (super_agent | project-agent slug) plus the
    // display name that was shown on the channel.
    ...(r.agent_slug || r.actor_id ? { agent: r.agent_slug || r.actor_id } : {}),
    ...(r.author ? { agent_name: r.author } : {}),
    ...(r.actor_kind ? { actor_kind: r.actor_kind } : {}),
    ...(r.meta?.model ? { model: r.meta.model } : {}),
    ...(usage && typeof usage === "object" ? { usage } : {}),
    // What the turn actually did. Recorded compactly at write time
    // (core/agent/tool-summary.js) because the live tool events are gone
    // by the time anyone reads the thread back.
    ...(r.meta?.tool_summary ? { tool_summary: r.meta.tool_summary } : {}),
    // Which skills the per-turn RAG put in the prompt. Same reasoning as
    // tool_summary: the live `skill_inspector` event is gone by read time.
    ...(r.meta?.skill_inspector ? { skill_inspector: r.meta.skill_inspector } : {}),
    // The model's thinking for that turn, one entry per model pass. Kept in
    // meta and handed out only here, so it reaches the thread viewer and
    // nothing that feeds the model.
    ...(Array.isArray(r.meta?.reasoning) && r.meta.reasoning.length
      ? { reasoning: r.meta.reasoning }
      : {}),
  };
}

export function readGlobalThread({ channel, date, project, _globalMessagesDir } = {}) {
  if (!CHANNEL_NAME_RE.test(String(channel || ""))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
  const base = _globalMessagesDir || GLOBAL_MESSAGES_DIR;
  const file = path.join(base, channel, `${date}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const messages = keepForProject(
    parseDayJsonl(fs.readFileSync(file, "utf8"))
      .filter((r) => r.type === "user" || r.type === "agent" || r.type === "tool"),
    project,
  ).map(shapeLedgerMessage);
  // A day-file the asking project owns no turn in is not its thread to read.
  // The file exists — another project's chat is in it — so without this a
  // stale link or a bookmarked URL opened an empty pane instead of taking the
  // not-found path. Unscoped reads keep answering for the whole file.
  if (!messages.length && project !== undefined && project !== null && project !== "") return null;
  // The thread's name travels with it. Deriving it a second time on the client
  // would put the same rule in two places, and the reader's own name for it —
  // which only this index knows — would never reach the header at all.
  const over = readThreadMeta(base)[threadKey(channel, date)] || {};
  const firstUser = messages.find((m) => m.role === "user");
  const derived = String((firstUser || messages[0] || {}).content || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return {
    id: date,
    channel,
    title: over.title || derived || `${channel} · ${date}`,
    archived: over.archived || undefined,
    messages,
  };
}

// Delete one channel+day thread by removing its JSONL file. The global ledger
// is FS-backed (listGlobalThreads/readGlobalThread read files directly), so
// unlinking the day-file drops the thread from the sidebar. Returns false for a
// bad channel/date or a file that is already gone.
export function deleteGlobalThread({ channel, date, project, _globalMessagesDir } = {}) {
  if (!CHANNEL_NAME_RE.test(String(channel || ""))) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return false;
  const base = _globalMessagesDir || GLOBAL_MESSAGES_DIR;
  const file = path.join(base, channel, `${date}.jsonl`);
  if (!fs.existsSync(file)) return false;
  // Scoped delete: a day-file can hold turns from several projects, and the
  // sidebar that offered the Delete button was showing only one of them.
  // Dropping the whole file there would take another project's chat with it —
  // including the default workspace's unstamped Telegram and desktop turns,
  // which the old predicate swept up on every scoped delete.
  if (project !== undefined && project !== null && project !== "") {
    const rows = parseDayJsonl(fs.readFileSync(file, "utf8"));
    const keep = rows.filter((r) => !rowBelongsTo(r, String(project)));
    if (keep.length === rows.length) return false;
    if (keep.length === 0) fs.unlinkSync(file);
    else fs.writeFileSync(file, keep.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return true;
  }
  fs.unlinkSync(file);
  return true;
}

// Wipe the cache and re-populate from APX project messages. Called by rebuild.
export function rebuildMessagesFromFs(db, projectRoot) {
  const dir = path.join(projectRoot, "messages");
  if (!fs.existsSync(dir)) return { count: 0 };
  db.prepare("DELETE FROM messages").run();

  // Collect every line from every .jsonl, parse, sort by ts so the SQL row
  // ids end up in the right order.
  const all = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
    all.push(...parseDayJsonl(fs.readFileSync(path.join(dir, f), "utf8")));
  }
  all.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));

  const tx = db.transaction(() => {
    for (const m of all) insertMessageRow(db, m);
  });
  tx();
  return { count: all.length };
}
