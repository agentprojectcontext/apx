// A runtime session, as a room.
//
// `call_runtime` spawns Claude Code (or Codex, or OpenCode…) and until now the
// only trace of it in a conversation was two rows — launched, finished — filed
// into the thread of whichever channel happened to launch it. That is a receipt,
// not a conversation: you could read that a session existed, and you could not
// talk to it.
//
// Manu, 2026-09-20: "claude code, codex y opencode deberían verse en la lista de
// chats y tratarse como grupo quizás — el agente habla como agente pero claude
// recibe como yo mismo, y yo veo los 3 tipos: mi mensaje, el del agente y el de
// claude".
//
// THREE VOICES, TWO SIDES. That observation is the whole design. From the
// runtime's point of view there is exactly one user: `claude -p` takes a prompt
// and does not care who typed it, so a prompt Roby sends and a prompt the owner
// sends arrive identically. From the ROOM's point of view there are three
// speakers, and the difference between them is worth keeping — "Roby le pidió
// esto en tu nombre" is not the same event as "vos le pediste esto".
//
// So every prompt row carries `meta.authored_by`, and the reader below is what
// turns one wire identity back into two speakers. The precedent is WhatsApp:
// `handleOwnWhatsAppMessage` stamps `authored_by: "owner"` for exactly this
// reason — to tell the human's bubble from the assistant's when both are
// `direction: "out"`.
//
// The storage is the group room's, deliberately: rows on the PROJECT ledger,
// one channel, a control row that makes the room exist before anyone speaks,
// and the session id on every line. A room addressed by thread id is what lets
// the inbox, the chat viewer and the live feed pick it up with no new
// machinery — see core/stores/messages.js, "Group chats".
//
// THE ROOM ID IS `meta.apc_session`, not `meta.session_id`. Both are on these
// rows already and they are different things: `apc_session` is APX's own
// record (what /runtime-sessions lists and what .../continue resumes), while
// `session_id` is the ENGINE's — the uuid `claude -p` hands back and that
// `--resume` takes. Keying the room on the engine's id would lose every
// session that died before printing one.
import {
  readProjectMessages,
  readProjectMessagesInRange,
  shapeLedgerMessage,
  previewText,
  mediaFromMeta,
} from "./messages.js";
import { CHANNELS } from "#core/constants/channels.js";

/** Exported for the same reason GROUP_CHANNEL is: the daemon keys a live turn
 *  as project+channel+thread, and a second literal is how the ledger and the
 *  live-turn registry drift apart. */
export const RUNTIME_CHANNEL = CHANNELS.RUNTIME;

/** Who wrote a prompt, when it was not a person. */
export const OWNER = "owner";

/**
 * Open the room. Written BEFORE the runtime has produced anything, for the same
 * reason `group_created` is: a session that takes forty minutes is otherwise
 * forty minutes of nothing in every list, and a crash takes the record of the
 * launch with it.
 */
export function openRuntimeRoom(logMessage, { session_id, runtime, cwd = null, title = null, launched_by = OWNER }) {
  if (!session_id) throw new Error("a runtime room needs a session id");
  return logMessage({
    channel: RUNTIME_CHANNEL, direction: "out", type: "system", author: "system",
    body: "",
    meta: { apc_session: session_id, kind: "runtime_started", runtime, cwd: cwd || null, title: title || null, launched_by },
  });
}

/**
 * A prompt that went to the runtime, and who wrote it.
 *
 * `type: "user"` because that is what it WAS on the wire — the engine received
 * it as the user, whoever typed it. `authored_by` is what the reader splits on.
 */
export function appendRuntimePrompt(logMessage, session_id, { body, authored_by = OWNER, media = null, ts = null }) {
  const mine = authored_by === OWNER;
  return logMessage({
    channel: RUNTIME_CHANNEL,
    // `in` for the owner, matching every other channel's "the human spoke".
    // An agent's prompt is outbound work, not inbound mail.
    direction: mine ? "in" : "out",
    type: "user",
    author: authored_by,
    actor_kind: mine ? "user" : "agent",
    body,
    ...(ts ? { ts } : {}),
    meta: { apc_session: session_id, authored_by, ...(media || {}) },
  });
}

/**
 * What the runtime answered, signed by the ENGINE.
 *
 * `actor_kind: "engine"` is what makes the panel draw it as its own voice with
 * the engine's logo rather than as more of the agent's prose — the same stamp
 * core/agent/runtime-thread.js puts on the rows it files into a channel thread.
 */
export function appendRuntimeReply(logMessage, session_id, { runtime, body, ok = true, error = null, model = null, usage = null, ts = null }) {
  return logMessage({
    channel: RUNTIME_CHANNEL, direction: "out", type: "agent",
    agent_slug: runtime, author: runtime, actor_id: runtime, actor_kind: "engine",
    body: body || "",
    ...(ts ? { ts } : {}),
    meta: {
      apc_session: session_id, runtime, final: true,
      phase: ok ? "done" : "failed",
      ...(error ? { error: String(error).slice(0, 500) } : {}),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
    },
  });
}

function roomRows(projectRoot, session_id) {
  return shapeRows(readProjectMessages(projectRoot, { channel: RUNTIME_CHANNEL, limit: 4000 }), session_id);
}

function shapeRows(rows, session_id) {
  return rows
    .filter((m) => m.channel === RUNTIME_CHANNEL)
    .filter((m) => m.meta?.apc_session && (session_id ? m.meta.apc_session === session_id : true))
    .sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
}

const isControlRow = (r) => !!r.meta?.kind || r.type === "system";

/** The first line of the first prompt, which is what a session is actually
 *  called in a list of them. A stored title wins when there is one. */
function titleFor(room) {
  if (room.title) return room.title;
  const first = room.display.find((r) => r.type === "user");
  const line = String(first?.body || "").trim().split("\n")[0];
  return line ? line.slice(0, 80) : `Sesión de ${room.runtime || "runtime"}`;
}

/** One thread row per runtime session in this project, shaped like a
 *  listProjectGroupThreads row so the sidebar and the inbox render it with the
 *  machinery they already have. */
export function listProjectRuntimeRooms(projectRoot) {
  return roomsFrom(roomRows(projectRoot, null));
}

/**
 * The rooms that are still CONVERSATIONS, for the chat list.
 *
 * Two reasons this is not the function above with a filter on the end.
 *
 * The clutter: the chat list is the conversations you might answer, and this
 * machine has sessions going back to May. Twenty rooms from the last week are
 * the ones worth a row; the eighty-nine since May are an archive, and they have
 * a screen of their own (`/m/runtimes`).
 *
 * The cost: `readProjectMessages` filters by `since` AFTER parsing, so it opens
 * every day file a project has ever written whatever window you ask for — and
 * the inbox runs this once per project on a request path. `readProjectMessagesInRange`
 * exists for exactly that and answers the window from the file NAMES.
 */
export async function listRecentProjectRuntimeRooms(projectRoot, { days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await readProjectMessagesInRange(projectRoot, { since, limit: 4000 });
  return roomsFrom(shapeRows(rows, null));
}

function roomsFrom(rows) {
  const byId = new Map();
  for (const r of rows) {
    const sid = r.meta.apc_session;
    const room = byId.get(sid) || {
      id: sid, runtime: null, cwd: null, title: null, launched_by: null,
      created: null, display: [], last: null, lastEngine: null, phase: null,
    };
    if (r.meta.kind === "runtime_started") {
      room.runtime = r.meta.runtime || room.runtime;
      room.cwd = r.meta.cwd || room.cwd;
      room.title = r.meta.title || room.title;
      room.launched_by = r.meta.launched_by || room.launched_by;
      room.created = r.ts;
    }
    if (r.meta.runtime && !room.runtime) room.runtime = r.meta.runtime;
    if (!isControlRow(r)) {
      room.display.push(r);
      room.last = r;
      if (r.actor_kind === "engine") {
        room.lastEngine = r;
        room.phase = r.meta.phase || room.phase;
      }
    }
    byId.set(sid, room);
  }
  const out = [];
  for (const room of byId.values()) {
    out.push({
      id: room.id,
      channel: RUNTIME_CHANNEL,
      runtime: room.runtime,
      cwd: room.cwd,
      launched_by: room.launched_by,
      phase: room.phase,
      title: titleFor(room),
      // The room's roster, as slugs — the engine plus whoever has written to it.
      participants: participantsOf(room),
      messages: room.display.length,
      started_at: room.created || room.display[0]?.ts || "",
      last_ts: room.last?.ts || room.created || "",
      preview: room.last
        ? `${speakerLabel(room.last)}: ${previewText(room.last.body, mediaFromMeta(room.last.meta))}`.slice(0, 140)
        : undefined,
      // What the ENGINE said last. A room where the owner spoke last has
      // nothing new to tell them about — the same rule a group row follows.
      preview_at: room.lastEngine?.ts || null,
    });
  }
  out.sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
  return out;
}

function participantsOf(room) {
  const seen = [];
  for (const r of room.display) {
    const who = r.actor_kind === "engine" ? (r.meta?.runtime || r.author) : (r.meta?.authored_by || OWNER);
    if (who && !seen.includes(who)) seen.push(who);
  }
  if (room.runtime && !seen.includes(room.runtime)) seen.push(room.runtime);
  return seen;
}

const speakerLabel = (r) => ((r.meta?.authored_by || OWNER) === OWNER && r.type === "user" ? "vos" : (r.meta?.runtime || r.meta?.authored_by || r.author));

/**
 * One runtime room shaped for the web chat viewer — and this is where the three
 * voices come from.
 *
 * A prompt the OWNER wrote renders as `user` (their own bubble, on the right).
 * A prompt an AGENT wrote renders as that agent, carrying `on_behalf_of` so the
 * viewer can say it was written in the owner's name — because on the wire it
 * was: the engine read it as the user either way. The engine's own turns render
 * as the engine.
 */
export function readProjectRuntimeRoom(projectRoot, session_id) {
  const rows = roomRows(projectRoot, session_id);
  if (!rows.length) return null;
  let runtime = null;
  let cwd = null;
  let title = null;
  let launched_by = null;
  for (const r of rows) {
    if (r.meta.kind === "runtime_started") {
      runtime = r.meta.runtime || runtime;
      cwd = r.meta.cwd || cwd;
      title = r.meta.title || title;
      launched_by = r.meta.launched_by || launched_by;
    }
    if (r.meta.runtime && !runtime) runtime = r.meta.runtime;
  }
  // attribution-exempt: reader — shapes ledger rows for display, writes nothing.
  const messages = [];
  for (const r of rows) {
    if (isControlRow(r)) continue;
    if (r.type === "user" && (r.meta.authored_by || OWNER) === OWNER) {
      messages.push(shapeLedgerMessage(r));
    } else if (r.type === "user") {
      // attribution-exempt: reader — re-shapes a PROMPT row for display (it was
      // never an agent turn, so there is no model or usage to carry); writes nothing.
      messages.push({
        ...shapeLedgerMessage({ ...r, type: "agent", agent_slug: r.meta.authored_by || r.author, actor_kind: "agent" }),
        // "Se lo pidió en tu nombre." The engine cannot tell these apart; the
        // room can, and it is the only place the distinction survives.
        on_behalf_of: OWNER,
      });
    } else {
      messages.push(shapeLedgerMessage({ ...r, agent_slug: r.meta.runtime || r.actor_id || r.author, actor_kind: r.actor_kind || "engine" }));
    }
  }
  const display = rows.filter((r) => !isControlRow(r));
  return {
    id: session_id,
    channel: RUNTIME_CHANNEL,
    runtime,
    cwd,
    launched_by,
    title: titleFor({ title, display, runtime }),
    participants: participantsOf({ display, runtime }),
    messages,
  };
}
