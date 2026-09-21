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
 * `pending` is this tab's own turn, sent and not yet in the ledger: the prompt
 * plus an empty engine turn marked as running, which is what puts "está
 * contestando" on screen for the minutes a run takes.
 */
export function toChatMsgs(
  lines: RuntimeRoomMessage[],
  engine: string,
  pending?: PendingTurn | null,
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
    out.push({ role: "assistant", parts: [], ts: pending.ts, agent: engine, agentId: engine, pending: true });
  }
  return out;
}
