// A runtime session, written into the chat it was launched from.
//
// `call_runtime` spawns Claude Code (or Codex, or Aider…) and, until now, the
// only trace of it in a conversation was whatever the super-agent chose to say
// about it. On 2026-09-20 that produced the worst possible version of the
// story: six sessions were killed at the foreground deadline and Roby, reading
// a `{ok: true, deduped: true}`, told the owner they were running. Manu, the
// same afternoon: "así puedo ver qué hacen, qué hablan y qué sesiones vas
// lanzando".
//
// So the session says so itself. Two rows on the ledger of the channel the call
// came from — one when it starts, one when it ends — authored by the ENGINE
// (`actor_kind: "engine"`, `actor_id: "claude-code"`), not by the agent that
// launched it. The panel already draws one bubble per actor and ships a logo
// per engine, so a launched session reads as a third voice in the thread rather
// than as more of the agent's prose.
//
// WHY THIS IS ALSO THE DELIVERY PATH. Background mode used to require a
// `backgroundResultSink`, and exactly one surface wires one (Telegram). Any
// other channel fell through to a synchronous run on the 300s foreground
// deadline — a Claude Code session dies there, every time, having done a third
// of the job. A ledger row is a delivery everybody can receive: it lands in the
// thread, the live feed pushes it into whatever panel is open, and the inbox
// counts it. The A2A sink stays preferred where it exists (Roby relaying in his
// own voice is better than raw stdout); this is the floor beneath it, and the
// reason a session no longer has to be short enough to fit in five minutes.
import { appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";

/**
 * Channels that DON'T get these rows.
 *
 * `routine` keeps its own delivery path (writing here would double every run
 * into the inbox — the same rule api/super-agent.js applies to turns), and the
 * room channels are project-scoped ledgers addressed by thread id, not by
 * channel + day: `appendGlobalMessage` has nowhere to put a row for them.
 *
 * `runtime` is a room for the same reason and one more: it is where the session
 * ALREADY narrates itself (core/stores/runtime-room.js). Answering a session
 * from inside its own room and then filing a "🚀 lancé una sesión" notice about
 * it, in that same room, is the conversation telling you about itself.
 */
const NO_THREAD = new Set([CHANNELS.ROUTINE, CHANNELS.A2A, "group", CHANNELS.RUNTIME]);

/** Can a launched session narrate itself into this channel? */
export function runtimeThreadCanCarry(channel) {
  return !!channel && !NO_THREAD.has(channel);
}

/** Which project the chat was opened from — the same stamp turns carry, so the
 *  row is found from the project and not only from the Base workspace. */
function scopeOf(project) {
  return project ? { project_id: String(project.id), project_name: project.name } : {};
}

/** Enough of a prompt to recognise WHICH session this is, in a list of them. */
const PROMPT_PREVIEW = 400;

/** The result the row carries. Long enough to be the answer, short enough that
 *  a transcript dump cannot take over the thread — the full text is always on
 *  the session record. */
const RESULT_MAX = 6000;

function post(row) {
  try {
    appendGlobalMessage(row);
    return true;
  } catch {
    // The ledger is a record, not a dependency: a failed write must never take
    // down the session it was describing.
    return false;
  }
}

/**
 * "I just started one." Written BEFORE the runtime has produced anything, for
 * the same reason an inbound turn is written before the model answers: a
 * session that takes forty minutes is otherwise forty minutes of nothing, and
 * a crash takes the record of the launch with it.
 */
export function postRuntimeLaunch({ channel, project, runtime, sessionId, cwd, prompt, background }) {
  if (!runtimeThreadCanCarry(channel)) return false;
  const head = background
    ? `🚀 Sesión de ${runtime} lanzada en segundo plano (\`${sessionId}\`)`
    : `🚀 Sesión de ${runtime} corriendo (\`${sessionId}\`)`;
  const where = cwd ? `\n📁 ${cwd}` : "";
  const task = String(prompt || "").trim().slice(0, PROMPT_PREVIEW);
  return post({
    channel,
    direction: "out",
    type: "agent",
    actor_id: runtime,
    actor_kind: "engine",
    author: runtime,
    body: `${head}${where}\n\n${task}${task.length >= PROMPT_PREVIEW ? "…" : ""}`,
    meta: { ...scopeOf(project), runtime, apc_session: sessionId, runtime_phase: "launched", cwd: cwd || null },
  });
}

/**
 * How it ended, in the same thread. `ok: false` is written too — a session that
 * failed silently is the failure mode this whole module exists to close.
 */
export function postRuntimeResult({ channel, project, runtime, sessionId, ok, text, error }) {
  if (!runtimeThreadCanCarry(channel)) return false;
  const head = ok
    ? `✅ Terminó la sesión de ${runtime} (\`${sessionId}\`)`
    : `⚠️ La sesión de ${runtime} (\`${sessionId}\`) no terminó bien: ${error || "sin detalle"}`;
  const body = String(text || "").trim().slice(0, RESULT_MAX);
  return post({
    channel,
    direction: "out",
    type: "agent",
    actor_id: runtime,
    actor_kind: "engine",
    author: runtime,
    body: body ? `${head}\n\n${body}` : head,
    meta: {
      ...scopeOf(project),
      runtime,
      apc_session: sessionId,
      runtime_phase: ok ? "done" : "failed",
      ...(ok ? {} : { error: String(error || "").slice(0, 500) }),
    },
  });
}
