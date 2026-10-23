// The agent's isolated Linux computer: its state, starting it and stopping it. Offered only in an owner's native chat,
// to an agent the owner allowed or, once the owner set the computer up, to one that may ask (DECISIONS.md#d-139).
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

function describe(s: Status, thread: string): string {
  const r = s.resources;
  const size = r ? ` · ${r.memory_gib} GiB memory, ${r.cpus} CPUs, ${r.disk_gib} GiB disk` : "";
  const elsewhere = s.thread && s.thread !== thread;
  if (elsewhere)
    return `Computer belongs to another chat${s.phase === "running" ? " and is running there" : ""}${size}.`;
  const why = s.last_stop ? ` (shut down ${STOPPED_BY[s.last_stop.reason]})` : "";
  const phase =
    s.phase === "running"
      ? `running; your shell and browser here run in it, in ${s.workspace}`
      : s.phase === "preparing"
        ? `starting (${s.step ?? "guest"})`
        : s.phase === "not_installed"
          ? "not set up yet: starting it downloads and prepares Linux, which takes several minutes"
          : s.phase === "error"
            ? `in error: ${s.error ?? "unknown"}`
            : `${s.phase ?? "off"}${why}`;
  const control = s.phase === "running" && s.control === "human" ? " The owner has control of it now." : "";
  const note = s.thread ? "" : " Starting it gives it to this chat.";
  return `Computer: ${phase}${size}.${control}${note}`;
}

/** Waits for the computer to leave a phase, as long as the call's own deadline allows. */
async function settle(vm: Computer, ctx: ToolContext, from: string[], ms: number): Promise<Status> {
  const end = Date.now() + ms;
  let s = await vm.status();
  while (s.phase && from.includes(s.phase) && Date.now() < end && !ctx.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    s = await vm.status();
  }
  return s;
}

export function vmTools(vm: Computer | undefined): Tool[] {
  if (!vm) return [];
  return [
    defineTool({
      name: COMPUTER_TOOL,
      description:
        "Your isolated Linux computer (a VM with its own desktop, shell and browser, apart from the owner's Mac): status, start or stop it. Starting needs free memory on this Mac; stop it when you are done so the memory goes back. The first use asks the owner to allow you.",
      args: z.object({ action: z.enum(["status", "start", "stop"]) }),
      effect: "local",
      reads: (a) => a.action === "status",
      confirm: () => "never",
      deadlineMs: 300_000,
      title: (a) =>
        a.action === "start"
          ? "Started the computer"
          : a.action === "stop"
            ? "Shut down the computer"
            : "Checked the computer",
      async run(a, ctx) {
        const thread = ctx.thread.id;
        if (!vm.permitted(ctx.agent.id, thread)) {
          const r = vm.resources();
          const no = await ctx.requestGrant(
            `${ctx.agent.name} asks to use the isolated Linux computer (${r.memory_gib} GiB memory, ${r.cpus} CPUs). In this chat its shell and browser would run inside it, not on this Mac.`,
            computerApproval,
          );
          if (no) return no;
        }
        if (a.action === "status") return describe(await vm.status(), thread);
        if (a.action === "start") {
          await ctx.call("environments.start", { thread });
          const s = await settle(vm, ctx, ["preparing"], 240_000);
          return s.phase === "preparing"
            ? `${describe(s, thread)} It is still starting: check again with status in a minute.`
            : describe(s, thread);
        }
        await ctx.call("environments.stop", { thread });
        return describe(await settle(vm, ctx, ["stopping", "running"], 90_000), thread);
      },
    }),
  ];
}
