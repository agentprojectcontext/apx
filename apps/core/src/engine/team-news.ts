// The team news: what the other agents' routines and notices had for the owner, waiting (engine/nudges.ts) for the
// super-agent's relay routine to tell it in one message. Taking it marks it told, so each piece is told once.
import type { Nudge } from "@apx/protocol";
import { ownerTimeZone } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";

/** At most this many pieces in one team news (the newest), each cut to this many characters. */
export const TEAM_NEWS_MAX = 30;
const PIECE_CHARS = 1200;

/** Who it came from: "April (april-check)" for a routine's news, the agent's name for its notice. */
function sourceOf(store: Store, kind: string): string {
  const [what, ...rest] = kind.split(":");
  const ref = rest.join(":");
  if (what === "agent") return store.agents.get(ref)?.name ?? ref;
  const routine = store.routines.list().find((r) => r.name === ref);
  const agent = routine ? store.agents.get(routine.agent_id)?.name : undefined;
  return agent ? `${agent} (${ref})` : ref;
}

function line(store: Store, n: Nudge, timeZone: string | undefined): string {
  const when = new Date(n.at).toLocaleString("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const text = n.text.length > PIECE_CHARS ? `${n.text.slice(0, PIECE_CHARS)}…` : n.text;
  return `- ${sourceOf(store, n.kind)}, ${when}:\n${text}`;
}

/** The waiting news as lines for the super-agent (none: nothing waits), marked told; the oldest past the cap dropped. */
export function takeTeamNews(store: Store): { count: number; lines: string } | undefined {
  const waiting = store.nudges.relayed();
  if (!waiting.length) return undefined;
  const told = waiting.slice(-TEAM_NEWS_MAX);
  const old = waiting.slice(0, -TEAM_NEWS_MAX);
  store.tx(() => {
    store.nudges.settle(
      told.map((n) => n.id),
      "merged",
      "told in the team news",
    );
    store.nudges.settle(
      old.map((n) => n.id),
      "dropped",
      "too many for one team news",
    );
  });
  const timeZone = ownerTimeZone(store);
  return { count: told.length, lines: told.map((n) => line(store, n, timeZone)).join("\n\n") };
}
