// When the owner and their agents last talked, for a message the agent writes them unasked (a routine, a report, the
// release news): mid-conversation it goes on as a chat does; only after a long silence does it greet. Data in the turn's
// input, never the system prompt (rules/PROMPT_SIZE.md). See DECISIONS.md#d-162
import type { Thread } from "@apx/protocol";
import type { Origin } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { inlineName } from "../tools/result.ts";

/** Silence this long, or a new day after a few hours, earns a greeting. */
export const GREET_AFTER_MS = 6 * 3600_000;
const NEW_DAY_AFTER_MS = 3 * 3600_000;
const EXCERPT_CHARS = 160;

/** A turn whose answer reaches the owner without their having just written: the ones that could open with a hello. */
export function unasked(origin: Origin): boolean {
  switch (origin.kind) {
    case "routine":
    case "job":
    case "computer_ready":
    case "stalled_task":
    case "task_result":
    case "delegation_result":
      return true;
    case "user":
    case "input_answer":
    case "channel":
    case "hours_began":
    case "agent":
    case "surface":
    case "terminal":
    case "go_on":
      return false;
  }
}

const ago = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

const dayOf = (at: Date, timeZone: string | undefined) => at.toLocaleDateString("en-CA", timeZone ? { timeZone } : {});

/**
 * One line for the turn's input: how long since the owner wrote and since the last message to them, and whether to
 * greet. The owner's channel lands in Home, so Home is always the conversation; the turn's own chat too, unless it is
 * a routine's (its prompt is not the owner talking) or another agent's.
 */
export function lastTalk(
  store: Store,
  thread: Pick<Thread, "id" | "kind">,
  at: Date,
  timeZone?: string | undefined,
  /** The turn being prepared: its own (still empty) message is not a past one. */
  runId?: string | undefined,
): string | undefined {
  if (thread.kind === "a2a") return undefined;
  const chats = [HOME_THREAD_ID, ...(thread.id !== HOME_THREAD_ID && thread.kind !== "routine" ? [thread.id] : [])];
  const owner = store.messages.latestBy(chats, "user");
  const agent = store.messages.latestBy(chats, "agent", runId)?.created_at;
  const sent = store.nudges.latestSent();
  const toThem = [agent, sent]
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1);
  const last = [owner?.created_at, toThem]
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1);
  if (!last) return "You and the owner have not talked yet: open with a short greeting.";
  const gap = at.getTime() - Date.parse(last);
  const words = owner?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ") ?? "";
  // Words from another chat are not in this turn's history: a line of them says what the conversation is about.
  const excerpt =
    owner && owner.thread_id !== thread.id && words.trim() ? `: "${inlineName(words, EXCERPT_CHARS)}"` : "";
  const facts = [
    owner
      ? `The owner last wrote ${ago(at.getTime() - Date.parse(owner.created_at))}${excerpt}.`
      : "The owner has not written yet.",
    toThem ? `The last message to them went ${ago(at.getTime() - Date.parse(toThem))}.` : "",
  ].filter(Boolean);
  const greet =
    gap >= GREET_AFTER_MS || (gap >= NEW_DAY_AFTER_MS && dayOf(at, timeZone) !== dayOf(new Date(last), timeZone));
  return `${facts.join(" ")} ${
    greet
      ? "You have not talked for a while: open with one short greeting for the time of day (by their name if you know it), without saying who you are."
      : 'You are mid-conversation: go on as in a chat, with no greeting, no "hello again" and no saying who you are.'
  }`;
}
