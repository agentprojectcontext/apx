// A coding session's ledger, turned into turns the chat components can draw.
//
// Pure functions, in their own file, for two reasons: the room renders through
// `MessageList`/`Composer` now and this is the whole of what sits between the
// daemon's rows and theirs, and logic with no DOM in it is testable directly
// (Node strips types from .ts — it cannot from the .tsx the component lives in).
import type { RuntimeRoomMessage } from "./api/runtimes";
import type { ChatMsg } from "../hooks/useChat";

/** A turn typed into this tab, sent, and not yet back from the daemon. */
export interface PendingTurn {
  text: string;
  ts: string;
}

/**
 * How long a prompt with no answer under it still counts as being worked on.
 *
 * The background deadline APX hands a coding session is one hour, so past that
 * the engine is not coming back and a spinner would be a promise nobody can
 * keep. It bounds the other direction too: opening a room from May whose last
 * row happens to be a prompt must not show it as live.
 */
export const STILL_ANSWERING_MS = 60 * 60 * 1000;

/** Did the ENGINE say this, as opposed to the owner or an agent? */
function isEngineReply(m: RuntimeRoomMessage): boolean {
  return m.actor_kind === "engine";
}

/**
 * Is the engine working on the last thing said to it?
 *
 * Read off the ROOM, not off what this tab happens to have sent: a session Roby
 * launched a minute ago is just as much in flight as one typed here, and the
 * answer has to survive a refresh. The room ends in a prompt exactly while
 * there is no reply under it — which is the whole of the question — bounded by
 * the deadline so a dead run does not spin for ever.
 */
export function isAnswering(lines: RuntimeRoomMessage[], now = Date.now()): boolean {
  const said = lines.filter((m) => m.role !== "tool" && m.role !== "system");
  const last = said[said.length - 1];
  if (!last || isEngineReply(last)) return false;
  const at = Date.parse(String(last.ts || ""));
  if (!Number.isFinite(at)) return false;
  return now - at < STILL_ANSWERING_MS;
}

/** How many turns in the room already say exactly this. */
export function countSaying(lines: RuntimeRoomMessage[], text: string): number {
  return lines.filter((m) => String(m.content || "").trim() === text).length;
}

/**
 * The three voices of a session, in the shape every other thread is drawn in.
 *
 * From the engine's side there is ONE user: `claude -p` takes a prompt and does
 * not care who typed it, so a prompt Roby sent and a prompt the owner sent
 * arrived identically. The room is the only place that difference survives, and
 * this is where it becomes something the chat components can draw:
 *
 *   the owner  → a user turn, their own bubble on the right, like any chat
 *   an agent   → an assistant turn under its own name, tagged "En tu nombre" —
 *                because that is exactly what it was
 *   the engine → an assistant turn under its own name and its own logo
 *
 * Asked for in those words on 2026-09-20: "el agente habla como agente pero
 * claude recibe como yo mismo, y yo veo los 3 tipos: mi mensaje, el del agente
 * y el de claude".
 *
 * `pending` is this tab's own turn, sent and not yet in the ledger — the gap
 * between pressing send and the next poll, in which the words had left the
 * composer and were nowhere on screen.
 *
 * The "está contestando" line is a SEPARATE question and comes from the room
 * itself (`isAnswering`): the prompt reaches the ledger immediately, long
 * before the engine finishes, so hanging the indicator off the locally-held
 * turn would have switched it off within four seconds of a run that takes
 * minutes — and shown nothing at all for a session somebody else launched.
 */
export function toChatMsgs(
  lines: RuntimeRoomMessage[],
  engine: string,
  pending?: PendingTurn | null,
  now = Date.now(),
): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of lines) {
    if (m.role === "tool" || m.role === "system") continue;
    const ts = m.ts || "";
    // A prompt the OWNER wrote: theirs, on the right.
    if (m.role === "user" && !m.on_behalf_of) {
      out.push({ role: "user", parts: [{ kind: "text", text: m.content }], ts });
      continue;
    }
    // Everyone else speaks on the left under their own name — an agent whose
    // words went out as the owner's, or the engine answering.
    out.push({
      role: "assistant",
      parts: [{ kind: "text", text: m.content }],
      ts,
      agent: m.agent_name || m.agent || engine,
      agentId: m.agent || undefined,
      ...(m.on_behalf_of ? { onBehalfOf: m.on_behalf_of } : {}),
    });
  }
  if (pending) {
    out.push({ role: "user", parts: [{ kind: "text", text: pending.text }], ts: pending.ts, local: true });
  }
  // One waiting bubble, whoever is being waited on. `pending` means this tab
  // just sent and the ledger has not caught up; otherwise the room answers it.
  if (pending || isAnswering(lines, now)) {
    const ts = pending?.ts || lines[lines.length - 1]?.ts || "";
    out.push({ role: "assistant", parts: [], ts, agent: engine, agentId: engine, pending: true });
  }
  return out;
}
