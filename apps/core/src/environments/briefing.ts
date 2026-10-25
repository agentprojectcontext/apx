// What an agent allowed the computer reads about it each turn, in its input (never the system prompt, which stays
// byte-stable): built from the same status the panel and the Computers view show, so it believes what the owner sees.
import type { Computer } from "./computer.ts";

type Status = Awaited<ReturnType<Computer["status"]>>;

const sizes = (r: { memory_gib?: number | undefined; cpus?: number | undefined; disk_gib?: number | undefined }) =>
  [
    r.memory_gib !== undefined && `${r.memory_gib} GiB memory`,
    r.cpus !== undefined && `${r.cpus} CPUs`,
    r.disk_gib !== undefined && `${r.disk_gib} GiB disk`,
  ]
    .filter(Boolean)
    .join(", ");

const STOPPED = {
  idle: "after its idle minutes",
  memory: "for lack of free memory",
  agent: "by an agent",
  owner: "by the owner",
};

/** A few lines: the computer's state and sizes, this agent's screen, whose hands it is in, what waits on the owner. */
export function computerBriefing(s: Status, agent: string, thread: string): string {
  const mine = s.screens?.find((x) => x.agent === agent);
  const here = s.chat?.on ? "this chat works on it" : "this chat works on this Mac";
  if (s.phase === "preparing")
    return `Computer: ${s.setup ? "being set up for the first time" : "starting"}; ${here}. You get a turn in a chat on it the moment it is ready.`;
  if (s.phase !== "running") {
    const why = s.last_stop ? ` (stopped ${STOPPED[s.last_stop.reason]})` : "";
    return `Computer: ${s.phase === "error" ? `in error: ${(s.error ?? "unknown").slice(0, 160)}` : `off${why}`}; ${here}. Start it with the computer tool when the owner's request needs it.`;
  }
  const now = s.running_resources ?? s.resources;
  const lines = [`Computer: running${now ? ` with ${sizes(now)}` : ""}; ${here}.`];
  if (!mine) lines.push("Your screen: not up; it comes up with your next turn in a chat on the computer.");
  else {
    const doing = mine.thread
      ? mine.thread === thread
        ? "working in this chat"
        : `working in your other chat "${(mine.title ?? "").slice(0, 60)}"`
      : "idle, kept up after your last run";
    lines.push(`Your screen: ${mine.display} (screen ${mine.screen}), ${doing}.`);
    lines.push(
      mine.control === "human"
        ? "Control: the owner has your screen in hand. Do not act on it; it waits on them to hand it back."
        : "Control: yours.",
    );
  }
  if (s.restart && s.running_resources && s.resources)
    lines.push(`The owner set ${sizes(s.resources)} for its next start.`);
  return lines.join(" ");
}
