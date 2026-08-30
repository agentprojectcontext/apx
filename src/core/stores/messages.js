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
import { summarizeToolTrace } from "../agent/tool-summary.js";
import { emitMessageEvent } from "../events/bus.js";
import { cleanTextOfPseudoToolCalls } from "../agent/tools/tool-call-parser.js";
import { attachmentsMeta } from "./media-archive.js";

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
    author: author || null,
    // `via` lets a subscriber tell a routine DELIVERY (an agent reaching the
    // owner) apart from an ordinary reply the owner is watching — the desktop
    // mascot bubbles the former even though it is `direction: "out"`.
    via: fullMeta.via || null,
    // A bounded (≤100 char) headline for that delivery, so the pet can say what
    // arrived without breaking "signal, not data" — it carries a notice, not the
    // message. Null on every ordinary row.
    notify: fullMeta.notify || null,
    // Closing vs mid-turn: the pet only bubbles the launched final on
    // Telegram / group / A2A, never the owner's send and never a stream chunk.
    final: fullMeta.final === true ? true : null,
    streamed: fullMeta.streamed === true ? true : null,
    // The a2a counterpart. `author` is who spoke; on an a2a row `meta.to` is who
    // was spoken TO, and the pet needs both ends to say "de magui a roby" rather
    // than naming a channel nobody can place. a2a ONLY: it is the one channel
    // where `to` is an agent's name and not an address (a chat id, a number)
    // that has no business on a signal feed.
    to: channel === "a2a" ? (fullMeta.to || null) : null,
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
const OMITTED_TURN =
  "[omitted: this turn contained data that may be stale — call the tool again instead of repeating it]";

function sanitizeAssistantForContext(content) {
  if (!content) return "";
  // A past turn that leaked wire format is the worst thing there is to replay:
  // the model reads its OWN voice writing a call as prose and does it again,
  // which is how one leaked turn becomes fourteen in a day. Scrub the markup
  // out of the history exactly as it is scrubbed out of an answer, so a reply
  // that leaked before this was fixed stops teaching the shape today rather
  // than when it ages out of the window. A turn that was nothing BUT markup
  // becomes the annotation below — "call the tool again" is precisely right
  // for a turn whose whole content was a call that never ran.
  content = cleanTextOfPseudoToolCalls(content) || "";
  if (!content.trim()) return OMITTED_TURN;
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
      return OMITTED_TURN;
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
      preview: `${last.author}: ${previewText(last.body, mediaFromMeta(last.meta))}`.slice(0, 140),
      // Every utterance in an a2a thread is an agent's, so "when an agent last
      // spoke" is simply the last row. The field exists so a notifier can ask
      // that question of any thread without knowing which kind it is.
      preview_at: last.ts,
    });
  }
  out.sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
  return out;
}

/** One a2a thread (by pair id) shaped for the web chat viewer: every utterance
 *  as an agent turn carrying its author, so the viewer can attribute each
 *  bubble to whichever agent spoke. Null when the pair has no messages. */
/**
 * A pointer a PEER keeps for its a2a thread with `from` — the most recent
 * `key` stamped on a row that peer itself spoke. Two live here: the runtime's
 * own session (`runtime_session_id`) and, for a coding exchange, the Code
 * module session it is mirrored into (`code_session_id`).
 *
 * The pointer lives on the ledger rather than in a side table, so a deleted
 * thread takes it with it and there is no second store to keep in sync. Null is
 * the ordinary first-turn answer: the peer then opens a session and reports it.
 *
 * `author === to` is load-bearing, not tidiness. A thread is keyed by the
 * unordered PAIR, so claude-code→opencode and opencode→claude-code are ONE
 * thread — and that one thread holds TWO sessions, one per peer. Without the
 * check the newer of them wins and is handed to the wrong CLI, which rejects it
 * outright ("Session not found").
 */
export function readA2APeerSession(projectRoot, { from, to, key = "runtime_session_id" }) {
  const pair = new Set([from, to]);
  const rows = readProjectMessages(projectRoot, { channel: "a2a", limit: 300 }).filter((m) => {
    if (!m.meta?.[key]) return false;
    if (m.author !== to) return false;
    const parts = [m.agent_slug, m.author, m.meta?.from, m.meta?.to].filter(Boolean);
    return parts.length > 0 && parts.every((p) => pair.has(p));
  });
  const last = rows.sort((a, b) => (a.ts || "").localeCompare(b.ts || "")).pop();
  return last?.meta?.[key] || null;
}

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
    // attribution-exempt: reader — shapeLedgerMessage READS model/usage from each row's meta; this shapes for display, it does not write a row.
    messages: uniq.map((m) =>
      shapeLedgerMessage({ ...m, type: "agent", agent_slug: m.author, actor_kind: m.actor_kind || "agent" }),
    ),
  };
}

/**
 * Delete a whole a2a pair thread: every ledger row the two agents exchanged,
 * across day files. Returns how many rows went.
 *
 * A pair id is DERIVED (see `a2aPair`) and never stored, so a line cannot be
 * matched on a field the way a group's `meta.group_id` can. Each line is read
 * back through `parseDayJsonl` — the one interpreter every reader uses — so a
 * row that lists under this pair is exactly a row that is removed here, with
 * no second derivation to drift from the first.
 *
 * The peers' session pointers (`runtime_session_id`, `code_session_id`) ride on
 * these same rows, so the thread takes them with it: the next exchange between
 * the two opens a fresh session instead of resuming one whose transcript is
 * gone. See `readA2APeerSession`.
 */
export function deleteA2AThread(projectRoot, id) {
  const want = String(id || "");
  const dir = path.join(projectRoot, "messages");
  if (!want || !fs.existsSync(dir)) return { removed: 0 };
  let removed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x))) {
    const full = path.join(dir, f);
    const lines = fs.readFileSync(full, "utf8").split("\n");
    let hits = 0;
    const kept = lines.filter((line) => {
      if (!line.trim()) return true;
      const [row] = parseDayJsonl(line);
      if (!row || row.channel !== "a2a") return true;
      if (a2aPairId(a2aPair(row)) !== want) return true;
      hits += 1;
      return false;
    });
    // Per FILE, not a running total: the day files that hold none of this pair
    // must not be rewritten just because an earlier one did.
    if (hits) {
      fs.writeFileSync(full, kept.join("\n"));
      removed += hits;
    }
  }
  return { removed };
}

// ── Group chats ───────────────────────────────────────────────────────────
// A group is the owner + N agents in one room. It rides the SAME ledger as a2a
// (channel "group"), so it lists, opens, and renders through the same thread
// machinery — no separate store. What a2a derives from message pairs, a group
// keeps explicit: a `group_created` control row carries the roster + title, and
// every message tags its `meta.group_id`. Owner turns are `type:"user"` (so the
// viewer puts them on the right); agent turns are `type:"agent"` attributed to
// the speaker; control rows (`meta.kind`) never render.
const GROUP_CHANNEL = "group";

function newGroupId() {
  // base36 time + a little entropy → short, URL-safe, and collision-proof for
  // two creations in the same millisecond.
  return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Create a room. Writes the `group_created` control row (roster + title) so
 *  the thread exists — and shows in every list — before anyone speaks. Returns
 *  the new group id. `logMessage` is the project's writer (db entry method).
 *
 *  `homes` (optional): `{ [slug]: projectId }` — when a room mixes agents from
 *  several projects, each speaker's home project is recorded so the turn runner
 *  can load the right `.apc` agent (and memory) instead of only the host's roster.
 */
export function createGroupThread(logMessage, { participants = [], title = null, homes = null } = {}) {
  const slugs = [...new Set(participants.filter(Boolean))];
  if (!slugs.length) throw new Error("a group needs at least one agent");
  const group_id = newGroupId();
  const homesMeta = homes && typeof homes === "object" && Object.keys(homes).length
    ? { homes }
    : {};
  logMessage({
    channel: GROUP_CHANNEL, direction: "out", type: "system", author: "system",
    body: "", meta: { group_id, kind: "group_created", participants: slugs, title, ...homesMeta },
  });
  return group_id;
}

/** Add an agent to a room (writes a `participant_added` control row carrying the
 *  full new roster, so the latest control row is always the source of truth).
 *  `added` is the joining slug, recorded so the transcript can show "… se sumó". */
export function addGroupParticipant(logMessage, group_id, participants, added = null) {
  logMessage({
    channel: GROUP_CHANNEL, direction: "out", type: "system", author: "system",
    body: "", meta: { group_id, kind: "participant_added", participants: [...new Set(participants)], ...(added ? { added } : {}) },
  });
}

/** Append the owner's line. `type:"user"` → the viewer renders it as sent-by-me.
 *  `media` (the `{media_kind, local_path, …}` shape from readTurnAttachments) is
 *  folded into meta so the transcript renders the photo/file the owner sent. */
export function appendGroupOwnerMessage(logMessage, group_id, body, media = null) {
  return logMessage({
    channel: GROUP_CHANNEL, direction: "in", type: "user", author: "owner",
    actor_kind: "user", body, meta: { group_id, ...(media || {}) },
  });
}

/** Append one agent's reply, attributed to it and carrying who summoned it.
 *  `media` is what it attached to this reply (attach_media) — archived and
 *  folded into meta so the room shows the image, not just the sentence. */
export function appendGroupAgentMessage(logMessage, group_id, { slug, body, reason = null, model = null, usage = null, trace = [], media = [] }) {
  const steps = Array.isArray(trace) ? trace.filter((s) => s?.tool) : [];
  const toolSummary = summarizeToolTrace(steps);
  for (const step of steps) {
    logMessage({
      channel: GROUP_CHANNEL, direction: "out", type: "tool", agent_slug: slug, author: slug,
      actor_id: step.tool, actor_kind: "tool",
      body: `${step.tool}(${JSON.stringify(step.args || {}).slice(0, 200)})`,
      meta: { group_id, tool: step.tool, args: step.args, result: step.result },
    });
  }
  return logMessage({
    channel: GROUP_CHANNEL, direction: "out", type: "agent", agent_slug: slug, author: slug,
    actor_kind: "agent", body,
    meta: {
      group_id,
      final: true,
      ...(reason ? { reason } : {}),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
      ...(toolSummary ? { tool_summary: toolSummary } : {}),
      ...attachmentsMeta(media),
    },
  });
}

function groupRows(projectRoot, group_id) {
  return readProjectMessages(projectRoot, { channel: GROUP_CHANNEL, limit: 4000 })
    .filter((m) => m.meta?.group_id && (group_id ? m.meta.group_id === group_id : true))
    .sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
}
const isControlRow = (r) => !!r.meta?.kind || r.type === "system";

/** One thread row per group in this project, shaped like a listProjectA2AThreads
 *  row so the web sidebar and inbox render it in a group. */
export function listProjectGroupThreads(projectRoot) {
  const byId = new Map();
  for (const r of groupRows(projectRoot, null)) {
    const gid = r.meta.group_id;
    const g = byId.get(gid) || { id: gid, participants: [], title: null, homes: null, created: null, display: [], last: null, lastAgent: null };
    if (Array.isArray(r.meta.participants)) g.participants = r.meta.participants; // latest control wins
    if (r.meta.homes && typeof r.meta.homes === "object") g.homes = r.meta.homes;
    if (r.meta.kind === "group_created") { g.title = r.meta.title || null; g.created = r.ts; }
    if (!isControlRow(r)) {
      g.display.push(r);
      g.last = r;
      // The last thing an AGENT said, tracked apart from the last thing said.
      // A room where the owner spoke last has nothing new to be told about.
      if (r.author !== "owner") g.lastAgent = r;
    }
    byId.set(gid, g);
  }
  const out = [];
  for (const g of byId.values()) {
    out.push({
      id: g.id,
      channel: GROUP_CHANNEL,
      title: g.title || g.participants.join(" · "),
      participants: g.participants,
      ...(g.homes ? { homes: g.homes } : {}),
      messages: g.display.length,
      started_at: g.created || (g.display[0]?.ts) || "",
      last_ts: g.last?.ts || g.created || "",
      preview: g.last
        ? `${g.last.author === "owner" ? "vos" : g.last.author}: ${previewText(g.last.body, mediaFromMeta(g.last.meta))}`.slice(0, 140)
        : undefined,
      preview_at: g.lastAgent?.ts || null,
    });
  }
  out.sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
  return out;
}

/** One group thread shaped for the web chat viewer: control rows drive roster +
 *  title; owner rows render as `user`, agent rows as `assistant` attributed to
 *  the speaker (same shaper every other channel uses). Null when unknown. */
export function readProjectGroupThread(projectRoot, group_id) {
  const rows = groupRows(projectRoot, group_id);
  if (!rows.length) return null;
  let participants = [];
  let title = null;
  let homes = null;
  for (const r of rows) {
    if (Array.isArray(r.meta.participants)) participants = r.meta.participants;
    if (r.meta.homes && typeof r.meta.homes === "object") homes = r.meta.homes;
    if (r.meta.kind === "group_created") title = r.meta.title || null;
  }
  // Join/leave control rows surface as centred system notices in the transcript
  // ("… se sumó al chat" / "… salió del chat"); group_created stays silent.
  // attribution-exempt: reader — shapes ledger rows for display, writes nothing.
  const messages = [];
  for (const r of rows) {
    if (r.meta.kind === "participant_added" && r.meta.added)
      messages.push({ role: "system", event: "joined", who: r.meta.added, ts: r.ts });
    else if (r.meta.kind === "participant_removed" && r.meta.left)
      messages.push({ role: "system", event: "left", who: r.meta.left, ts: r.ts });
    else if (isControlRow(r)) continue;
    else if (r.type === "user") messages.push(shapeLedgerMessage(r));
    else messages.push(shapeLedgerMessage({ ...r, agent_slug: r.actor_id || r.author, actor_kind: r.actor_kind || "agent" }));
  }
  return {
    id: group_id,
    channel: GROUP_CHANNEL,
    title: title || participants.join(" · "),
    participants,
    ...(homes ? { homes } : {}),
    messages,
  };
}

/**
 * Rewind a group: keep the first `keepVisible` PANE BUBBLES and drop the rest
 * from the ledger, so "regenerate"/"edit & resend" can overwrite everything
 * after a point — the same rewind the 1:1 chat's truncateConversation does, but
 * on the append-only ledger. Control rows (roster/title) and every other channel
 * are left untouched. Returns how many rows were removed.
 *
 * keepVisible matches what the web pane shows as bubbles:
 *   - tool rows ride with the agent turn that follows (do not count alone)
 *   - consecutive agent rows from the SAME speaker collapse into ONE bubble
 *     (threadToChatMsgs does the same). Counting each agent row separately
 *     under-counted keepVisible and deleted the owner's line when regenerating
 *     the next reply (e.g. two Candela rows → one UI bubble → cut too early).
 *
 * Unlike a2a (which refuses truncation — it is a record of two agents talking),
 * a group is an interactive chat the owner drives, so rewinding it is expected.
 */
export function truncateGroupThread(projectRoot, group_id, keepVisible) {
  const dir = path.join(projectRoot, "messages");
  if (!fs.existsSync(dir)) return { removed: 0 };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const raw = new Map();          // file -> raw line array
  const display = [];             // { file, idx, ts, type, author }
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
    raw.set(f, lines);
    lines.forEach((line, idx) => {
      const t = line.trim();
      if (!t) return;
      let obj; try { obj = JSON.parse(t); } catch { return; }
      if (!obj || obj.channel !== GROUP_CHANNEL || obj.meta?.group_id !== group_id) return;
      if (obj.meta?.kind || obj.type === "system") return; // control row — keep
      display.push({
        file: f,
        idx,
        ts: obj.ts || "",
        type: obj.type || "agent",
        author: obj.author || obj.agent_slug || "",
      });
    });
  }
  display.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));

  // Collapse into pane bubbles (same rules as threadToChatMsgs).
  const bubbles = []; // each: row refs
  let pendingTools = [];
  let lastActor = null; // "user" | "agent:<slug>"
  for (const d of display) {
    if (d.type === "tool") {
      pendingTools.push(d);
      continue;
    }
    if (d.type === "user") {
      bubbles.push([...pendingTools, d]);
      pendingTools = [];
      lastActor = "user";
      continue;
    }
    // agent (or any other non-tool display row attributed to a speaker)
    const actor = `agent:${d.author || "agent"}`;
    if (lastActor === actor && bubbles.length) {
      bubbles[bubbles.length - 1].push(...pendingTools, d);
    } else {
      bubbles.push([...pendingTools, d]);
    }
    pendingTools = [];
    lastActor = actor;
  }
  if (pendingTools.length) {
    // Orphan tools after the last turn — attach to last bubble or own drop unit.
    if (bubbles.length) bubbles[bubbles.length - 1].push(...pendingTools);
    else bubbles.push(pendingTools);
  }

  const cut = Math.max(0, keepVisible);
  const drop = new Set();
  const keyOf = (d) => `${d.file}#${d.idx}`;
  for (const bubble of bubbles.slice(cut)) {
    for (const d of bubble) drop.add(keyOf(d));
  }
  if (!drop.size) return { removed: 0 };
  for (const f of new Set([...drop].map((k) => k.slice(0, k.lastIndexOf("#"))))) {
    const kept = raw.get(f).filter((_, idx) => !drop.has(`${f}#${idx}`));
    fs.writeFileSync(path.join(dir, f), kept.join("\n"));
  }
  return { removed: drop.size };
}

/** The body of the last owner turn in a group — the seed a "regenerate" re-runs
 *  the cascade from, without appending a new owner message. Null if none. */
export function lastGroupOwnerMessage(projectRoot, group_id) {
  const rows = groupRows(projectRoot, group_id).filter((r) => r.type === "user");
  return rows.length ? (rows[rows.length - 1].body || "") : null;
}

/** The photo/file the last owner turn carried, as `{ path, name }` — so a
 *  regenerate can re-attach it and vision keeps working. Null when that turn had
 *  no media (or there is no owner turn). */
export function lastGroupOwnerMedia(projectRoot, group_id) {
  const rows = groupRows(projectRoot, group_id).filter((r) => r.type === "user");
  const last = rows[rows.length - 1];
  const m = last?.meta;
  if (!m?.local_path) return null;
  return { path: m.local_path, name: m.file_name || undefined };
}

/** Delete a whole group room: every ledger row for it (messages AND control
 *  rows), across day files. Returns how many rows were removed. */
export function deleteGroupThread(projectRoot, group_id) {
  const dir = path.join(projectRoot, "messages");
  if (!fs.existsSync(dir)) return { removed: 0 };
  let removed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    const full = path.join(dir, f);
    const lines = fs.readFileSync(full, "utf8").split("\n");
    const kept = lines.filter((line) => {
      const t = line.trim();
      if (!t) return true;
      let obj; try { obj = JSON.parse(t); } catch { return true; }
      const hit = obj?.channel === GROUP_CHANNEL && obj.meta?.group_id === group_id;
      if (hit) removed += 1;
      return !hit;
    });
    if (removed) fs.writeFileSync(full, kept.join("\n"));
  }
  return { removed };
}

/** Remove an agent from a room, recording it as a visible notice ("… salió del
 *  chat") so the transcript shows who left and the agents stop citing them. */
export function removeGroupParticipant(logMessage, group_id, slug, participants) {
  logMessage({
    channel: GROUP_CHANNEL, direction: "out", type: "system", author: "system",
    body: "", meta: { group_id, kind: "participant_removed", participants: [...participants], left: slug },
  });
}

/** Repoint a room's roster after an agent's slug changed. The roster lives in
 *  the LATEST control row (and `homes` maps slug → home project), so a rename is
 *  one more control row: same room, same history, new key. Without it the runner
 *  cannot resolve the speaker (`bySlug`) and the agent falls out of the room in
 *  silence. Rows already written keep their old `agent_slug` — those are a
 *  record of who spoke, not a pointer.
 *
 *  Takes `projectRoot` rather than a `logMessage` (unlike every other writer
 *  here) because it has to READ the threads to find the ones that name the
 *  slug, and it runs from the core sweep (apc/agent-rename-refs.js) where no
 *  daemon entry is in hand.
 *
 *  `homeId` scopes a mixed-project room to the renamed agent's own project, so
 *  two projects that both own a "magui" never repoint each other's member;
 *  `hostId` is who a participant belongs to when the room has no `homes` map
 *  (single-project by construction). Passing neither renames every match.
 *
 *  @returns {number} rooms repointed
 */
export function renameGroupParticipant(projectRoot, oldSlug, newSlug, { homeId = null, hostId = null } = {}) {
  if (!projectRoot || !oldSlug || !newSlug || oldSlug === newSlug) return 0;
  let changed = 0;
  for (const thread of listProjectGroupThreads(projectRoot)) {
    if (!Array.isArray(thread.participants) || !thread.participants.includes(oldSlug)) continue;
    const homes = thread.homes && typeof thread.homes === "object" ? thread.homes : null;
    const owner = homes?.[oldSlug] ?? hostId;
    if (homeId != null && String(owner ?? homeId) !== String(homeId)) continue;
    const participants = [...new Set(thread.participants.map((s) => (s === oldSlug ? newSlug : s)))];
    const nextHomes = homes
      ? Object.fromEntries(Object.entries(homes).map(([s, id]) => [s === oldSlug ? newSlug : s, id]))
      : null;
    appendMessageToFs({
      projectRoot, channel: GROUP_CHANNEL, direction: "out", type: "system", author: "system",
      body: "",
      meta: {
        group_id: thread.id, kind: "participant_renamed", participants,
        ...(nextHomes ? { homes: nextHomes } : {}), from: oldSlug, to: newSlug,
      },
    });
    changed += 1;
  }
  return changed;
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

const flatten = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// The invocation that introduces a result, rendered so it cannot be mistaken
// for one. This half is why the record is readable at all — "1247" means
// nothing without "wc -l on X" — but the form matters as much as the content:
// `{"command":"ls"}` IS a call, and a model that reads its own history finds a
// worked example of writing calls as prose, copies it, and the loop (which
// sees no tool_calls) delivers the transcript to the user as the answer.
// `command=ls` carries the same question with no wire format to imitate.
function renderToolCallSummary(m, name) {
  let args = m.meta?.args;
  const raw = flatten(m.body);
  // `body` is "<name>(<args>)" and the name is already in the prefix — keep
  // only the arguments so the cap buys context, not a repeated tool name.
  const inner = raw.startsWith(`${name}(`) && raw.endsWith(")")
    ? raw.slice(name.length + 1, -1)
    : raw;
  if (args === undefined || args === null) {
    try { args = JSON.parse(inner); } catch { /* not JSON — fall back to text */ }
  }
  const text =
    args && typeof args === "object" && !Array.isArray(args)
      ? Object.entries(args)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ")
      : inner;
  // Belt and braces, literally: an argument object is the one shape that reads
  // back as a real call, so no `{}` survives into the history at all.
  return flatten(text).replace(/[{}]/g, "").slice(0, TOOL_CALL_CAP);
}

// Names the lines below for whoever reads them back. Not decoration: for Gemini
// and Anthropic a mid-history system turn arrives as a USER turn, and a bare
// `[tool result: …]` line there reads as something the user typed and is owed a
// reply. This says what it is and that it is nobody's turn.
const TOOL_LOG_HEADER =
  "[Tool log — what already ran in this conversation. Not from the user, not " +
  "your own words, and nothing here is waiting on a reply. Read it for facts; " +
  "to act again, call the tool.]";

// Truncated, prefixed rendering of a tool record for model context (Pieza 3).
// Shape: `[tool result: <name>] (<short invocation>) → <result>`. The result
// gets the bulk of the budget.
//
// The prefix says "result", not "<name>", on purpose: it is an annotation
// ABOUT a past turn, `cleanTextOfPseudoToolCalls` strips the whole line out of
// anything a model says, and it matches what the RAG indexer writes for the
// same record. `[tool <name>] <args>` — what this rendered between 2026-08-19
// and 2026-08-26 — looked instead like a call, and gemini-3.7-flash echoed it
// straight back at the user, tools never running (see tool-markup-leak.test.js).
function renderToolResult(m) {
  const name = m.meta?.tool_name || m.meta?.tool || m.actor_id || "tool";
  const call = renderToolCallSummary(m, name);
  const result = flatten(renderToolResultBody(m));
  const head = call ? `[tool result: ${name}] (${call})` : `[tool result: ${name}]`;
  if (!result) return head.slice(0, TOOL_CONTEXT_CAP);
  return `${head} → ` + result.slice(0, Math.max(120, TOOL_CONTEXT_CAP - head.length - 3));
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
//   - tool records are INCLUDED as "[tool result: <name>] (<call>) → <result>",
//     the RESULT truncated to fit TOOL_CONTEXT_CAP (kept on the assistant side)
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
  // Whether the previous record was also a tool, so only the first line of each
  // contiguous run carries the header.
  let inToolRun = false;
  for (const m of kept) {
    if (m.type === "tool") {
      // On the SYSTEM side, never the assistant's. A tool result is something
      // that was observed, not something the agent said — and putting it in the
      // agent's own voice is what taught the agent to fake it.
      //
      // With `role: "assistant"` these lines were coalesced into the model's
      // own turns, once per tool it had ever run: in a busy Telegram thread,
      // 62% of the window was the model apparently answering in the shape
      // `[tool result: run_shell] (command=…) → …` followed by prose. That is a
      // worked example of narrating tool calls instead of making them, and on
      // 2026-08-29 a fallback model copied it — five fabricated `[result:
      // shell]` lines and a confident "I sent the WhatsApp". Nothing had run.
      //
      // Fixing the SHAPE was tried first (see the tests); the shape is not what
      // makes it copyable, the SIDE is. Here the same text is unmistakably a
      // log about the conversation rather than a turn in it, which is exactly
      // how the compacted summary above already rides.
      //
      // Headed on the first line of each contiguous run, because for Gemini and
      // Anthropic a mid-history system turn is serialised as a USER turn — and
      // an unlabelled `[tool result: …]` arriving as the user's words is
      // something a model will try to answer. The header says whose lines these
      // are and that nobody is waiting on them.
      const line = renderToolResult(m);
      turns.push({ role: "system", content: inToolRun ? line : `${TOOL_LOG_HEADER}\n${line}` });
      inToolRun = true;
    } else {
      inToolRun = false;
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
    author: author || null,
    via: fullMeta.via || null,
    notify: fullMeta.notify || null,
    final: fullMeta.final === true ? true : null,
    streamed: fullMeta.streamed === true ? true : null,
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

const MEDIA_GLYPH = {
  photo: "📷", audio: "🎤", video: "🎬", animation: "🎞", document: "📄", file: "📎",
};

/**
 * The one-line preview a list shows for a turn — the chat list, the inbox row,
 * a notification.
 *
 * A turn that carried a file has machine-facing text: the marker the agent was
 * handed inbound ("[image attached — saved to /Users/…]") or the placeholder
 * written outbound when the send had no caption ("[photo]"). Printing it raw is
 * how a photo showed up in the list as a file path. The thread already strips
 * that marker to render the file; this is the same decision for the one line
 * that stands in for the thread.
 *
 * A glyph rather than a word: this text is produced server-side and read in
 * whatever language the panel is set to, and "📷 el agarre" needs no catalog.
 *
 * @param {string} body        the row's stored text
 * @param {object|null} media  what mediaFromMeta returned for that row
 */
export function previewText(body, media) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!media) return text;
  const caption = text.replace(/^\[[^\]]*\]\s*/, "").trim();
  const glyph = MEDIA_GLYPH[media.kind] || MEDIA_GLYPH.file;
  return `${glyph} ${caption || media.name || media.kind}`.trim();
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
    // Group only: which agent's @mention pulled this speaker in ("traído por X").
    ...(r.meta?.reason ? { reason: r.meta.reason } : {}),
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
