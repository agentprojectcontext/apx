// The shared Linux computer as an agent sees it: its state, starting it (and taking the agent's own screen) and
// leaving it. Offered only in an owner's native chat other than Home, to an agent the owner allowed
// (DECISIONS.md#d-152, DECISIONS.md#d-154).
import { z } from "zod";
import type { Computer } from "../environments/computer.ts";
import { errorMessage } from "../errors.ts";
import { defineTool, type Tool, type ToolContext } from "./types.ts";

export const COMPUTER_TOOL = "computer";
const START_DEADLINE_MS = 300_000;
/** How long a start waits for a computer already coming up before it hands the wait to the ready turn. */
const FIRST_LOOK_MS = 3_000;

type Status = Awaited<ReturnType<Computer["status"]>>;

const STOPPED_BY = {
  idle: "after its idle minutes",
  memory: "for lack of free memory",
  agent: "by an agent",
  owner: "by the owner",
};

type Sizes = { memory_gib?: number | undefined; cpus?: number | undefined; disk_gib?: number | undefined };

const sizes = (r: Sizes) =>
  [
    r.memory_gib !== undefined && `${r.memory_gib} GiB memory`,
    r.cpus !== undefined && `${r.cpus} CPUs`,
    r.disk_gib !== undefined && `${r.disk_gib} GiB disk`,
  ]
    .filter(Boolean)
    .join(", ");

/** What it runs with now, and apart from it what the owner set for its next start; off, only the latter. */
function sizeOf(s: Status): string {
  const next = s.resources;
  const now = s.phase === "running" ? s.running_resources : undefined;
  if (now)
    return ` · running with ${sizes(now)}${s.restart && next ? `; set to ${sizes(next)} from its next start` : ""}`;
  return next ? ` · ${sizes(next)} when it starts` : "";
}

function describe(s: Status, run: string): string {
  const size = sizeOf(s);
  const why = s.last_stop ? ` (shut down ${STOPPED_BY[s.last_stop.reason]})` : "";
  const mine = s.screens?.find((x) => x.run === run);
  const up = s.screens?.length ?? 0;
  const phase =
    s.phase === "running"
      ? mine
        ? `running; you hold your screen ${mine.display}, and your shell and browser here run on it as your own user, in ~/work`
        : `running; ${up} of ${s.max_screens ?? 1} agent screens are up`
      : s.phase === "preparing"
        ? `starting (${s.step ?? "guest"})`
        : s.phase === "not_installed"
          ? "not set up yet: starting it downloads and prepares Linux, which takes several minutes"
          : s.phase === "error"
            ? `in error: ${s.error ?? "unknown"}`
            : `${s.phase ?? "off"}${why}`;
  const owner = mine?.control === "human" ? " The owner has your screen in hand now." : "";
  const chat = s.chat?.on
    ? s.phase === "preparing"
      ? " This chat works on it: you get a turn here the moment it is ready, on your own screen. Tell the owner once that you will go on then, and end your turn; do not check on it meanwhile."
      : ""
    : " This chat works on this Mac; starting the computer moves it there.";
  return `Computer (shared by the agents): ${phase}${size}.${owner}${chat}`;
}

/** Waits for the computer to leave a phase, as long as the call's own deadline allows. */
async function settle(vm: Computer, ctx: ToolContext, from: string[], ms: number): Promise<Status> {
  const end = Date.now() + ms;
  let s = await vm.status(ctx.thread.id);
  while (s.phase && from.includes(s.phase) && Date.now() < end && !ctx.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    s = await vm.status(ctx.thread.id);
  }
  return s;
}

export function vmTools(vm: Computer | undefined): Tool[] {
  if (!vm) return [];
  return [
    defineTool({
      name: COMPUTER_TOOL,
      description:
        "The Linux computer the agents share (a VM apart from the owner's Mac; you get your own user, files and screen with a desktop and browser): status, start (moves this chat there; your shell and browser then run on your screen) or stop (this chat back on the Mac, your screen freed). Only for work the owner wants on it: if they did not say where, ask them first (the computer or this Mac). The web (look-ups, sites, their logins) goes through web_search, web_read and their browser on this Mac unless they ask for the computer. Starting needs free memory.",
      args: z.object({ action: z.enum(["status", "start", "stop"]) }),
      effect: "local",
      reads: (a) => a.action === "status",
      confirm: () => "never",
      deadlineMs: START_DEADLINE_MS,
      title: (a) =>
        a.action === "start"
          ? "Started the computer"
          : a.action === "stop"
            ? "Left the computer"
            : "Checked the computer",
      async run(a, ctx) {
        const thread = ctx.thread.id;
        // Taken away during this turn: the owner decided, so it is not asked again.
        if (!vm.permitted(ctx.agent.id, thread))
          return "Not allowed: the owner no longer lets you use the computer. Carry on with this Mac's tools.";
        if (a.action === "status") return describe(await vm.status(thread), ctx.run.id);
        if (a.action === "stop") {
          await ctx.call("environments.release", { thread });
          return "Left the computer: this chat works on this Mac again from your next turn, and your screen is free. The computer shuts down by itself once no agent uses it.";
        }
        const later = (s: Status) =>
          `${describe(s, ctx.run.id)} It is still starting: check again with status in a minute.`;
        // Each start may wait for a screen (screens.ts CLAIM_MS), twice at most, within the call's deadline.
        const take = async () => {
          try {
            await ctx.call("environments.start", { thread });
            return true;
          } catch (error) {
            const why = errorMessage(error);
            if (/did not start in time/.test(why)) return false;
            if (/not enough free memory/.test(why)) return why;
            throw error;
          }
        };
        const taken = await take();
        if (typeof taken === "string")
          return `Not started: ${taken}. Tell the owner why in their language, with those numbers, and give them [Computer](apx:computer) to lower its memory or close apps; do not try again until they say so.`;
        if (!taken) return later(await vm.status(thread));
        let s = await settle(vm, ctx, ["preparing"], FIRST_LOOK_MS);
        if (s.phase === "preparing") {
          // A boot or a first setup takes minutes: this turn ends, and the chat gets a turn the moment it is up.
          vm.whenReady(thread, ctx.agent.id, s);
          const first = s.setup ? " Its first setup downloads Linux and takes several minutes." : "";
          return `The computer is starting.${first} You get a turn in this chat the moment it is ready: tell the owner in one short line, in their language, that you will let them know, and end your turn now; do not check on it meanwhile.`;
        }
        // Started just now: the screen is taken once the computer runs.
        if (s.phase === "running" && !s.screens?.some((x) => x.run === ctx.run.id)) {
          if (!(await take())) return later(await vm.status(thread));
          s = await vm.status(thread);
        }
        return describe(s, ctx.run.id);
      },
    }),
  ];
}
