// The shared Linux computer as an agent sees it: its state, starting it (and taking the agent's own screen) and
// leaving it. Offered only in an owner's native chat, to an agent the owner allowed or, once the owner set the
// computer up, to one that may ask (DECISIONS.md#d-139, DECISIONS.md#d-140).
import { z } from "zod";
import { type Computer, computerApproval } from "../environments/computer.ts";
import { defineTool, type Tool, type ToolContext } from "./types.ts";

export const COMPUTER_TOOL = "computer";

type Status = Awaited<ReturnType<Computer["status"]>>;

const STOPPED_BY = {
  idle: "after its idle minutes",
  memory: "for lack of free memory",
  agent: "by an agent",
  owner: "by the owner",
};

function describe(s: Status, run: string): string {
  const r = s.resources;
  const size = r ? ` · ${r.memory_gib} GiB memory, ${r.cpus} CPUs, ${r.disk_gib} GiB disk` : "";
  const why = s.last_stop ? ` (shut down ${STOPPED_BY[s.last_stop.reason]})` : "";
  const mine = s.screens?.find((x) => x.run === run);
  const held = s.screens?.filter((x) => x.run).length ?? 0;
  const phase =
    s.phase === "running"
      ? mine
        ? `running; you hold your screen ${mine.display}, and your shell and browser here run on it as your own user, in ~/work`
        : `running; ${held} of ${s.max_screens ?? 1} agent screens are held`
      : s.phase === "preparing"
        ? `starting (${s.step ?? "guest"})`
        : s.phase === "not_installed"
          ? "not set up yet: starting it downloads and prepares Linux, which takes several minutes"
          : s.phase === "error"
            ? `in error: ${s.error ?? "unknown"}`
            : `${s.phase ?? "off"}${why}`;
  const owner = mine?.control === "human" ? " The owner has your screen in hand now." : "";
  const chat = s.chat?.on ? "" : " This chat works on this Mac; starting the computer moves it there.";
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
        "The Linux computer the agents share (a VM apart from the owner's Mac; you get your own user, files and screen with a desktop and browser): status, start (moves this chat there; your shell and browser then run on your screen) or stop (this chat back on the Mac, your screen freed). Starting needs free memory; the first use asks the owner to allow you.",
      args: z.object({ action: z.enum(["status", "start", "stop"]) }),
      effect: "local",
      reads: (a) => a.action === "status",
      confirm: () => "never",
      deadlineMs: 300_000,
      title: (a) =>
        a.action === "start"
          ? "Started the computer"
          : a.action === "stop"
            ? "Left the computer"
            : "Checked the computer",
      async run(a, ctx) {
        const thread = ctx.thread.id;
        if (!vm.permitted(ctx.agent.id, thread)) {
          const r = vm.resources();
          const no = await ctx.requestGrant(
            `${ctx.agent.name} asks to use the shared Linux computer (${r.memory_gib} GiB memory, ${r.cpus} CPUs), with its own user and screen. In this chat its shell and browser would run there, not on this Mac.`,
            computerApproval,
          );
          if (no) return no;
        }
        if (a.action === "status") return describe(await vm.status(thread), ctx.run.id);
        if (a.action === "stop") {
          await ctx.call("environments.release", { thread });
          return "Left the computer: this chat works on this Mac again from your next turn, and your screen is free. The computer shuts down by itself once no agent uses it.";
        }
        await ctx.call("environments.start", { thread });
        let s = await settle(vm, ctx, ["preparing"], 240_000);
        // Started just now: the screen is taken once the computer runs.
        if (s.phase === "running" && !s.screens?.some((x) => x.run === ctx.run.id)) {
          await ctx.call("environments.start", { thread });
          s = await vm.status(thread);
        }
        return s.phase === "preparing"
          ? `${describe(s, ctx.run.id)} It is still starting: check again with status in a minute.`
          : describe(s, ctx.run.id);
      },
    }),
  ];
}
