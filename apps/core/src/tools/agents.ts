// Finding and asking other agents. `delegate` is the only way an agent talks to another one.
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { cap, untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export const MAX_DEPTH = 2;

export function agentTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "list_agents",
      description: "List agents with their ids and projects. Optional filter by project name or text in name/role.",
      args: z.object({ query: z.string().optional().describe("project name or text to match (optional)") }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked up agents",
      async run(a, ctx) {
        const q = (a.query ?? "").toLowerCase();
        const [{ agents }, { projects }] = await Promise.all([
          ctx.call("agents.list", {}),
          ctx.call("projects.list", {}),
        ]);
        const names = new Map(projects.map((p) => [p.id, p.name]));
        const rows = agents
          .map((x) => ({ ...x, project: x.project_id ? (names.get(x.project_id) ?? "") : "" }))
          .filter((x) => !q || `${x.name} ${x.role} ${x.project}`.toLowerCase().includes(q))
          .slice(0, 40)
          .map((x) => `- ${x.name} (id: ${x.id})${x.project ? ` [${x.project}]` : ""}${x.role ? `: ${x.role}` : ""}`);
        return rows.length ? rows.join("\n") : "no agents match";
      },
    }),
    defineTool({
      name: "delegate",
      description:
        "Ask another agent to do a task (use its id; a name works when it is unique). It works in a sub-thread the owner can open. If it answers within wait_s you get the answer now; otherwise you get the result later in a new turn: never poll for it.",
      args: z.object({
        agent: z.string().describe("agent id (or unique name)"),
        task: z.string().min(1).describe("clear, self-contained task with everything the other agent needs"),
        wait_s: z.number().int().min(0).max(120).optional().describe("seconds to wait inside this turn (default 60)"),
      }),
      effect: "message",
      // The wait itself is bounded by wait_s; this covers the bookkeeping around it.
      deadlineMs: 130_000,
      title: (a) => `Asked ${String(a.agent)}`,
      async run(a, ctx) {
        if (ctx.run.depth >= MAX_DEPTH) return "refused: delegation depth limit reached; do it yourself.";
        const found = store.agents.resolve(a.agent, ctx.thread.project_id);
        if ("error" in found) return found.error;
        if (found.agent.id === ctx.agent.id) return "refused: you cannot delegate to yourself.";
        return ctx.delegate(found.agent, a.task, (a.wait_s ?? 60) * 1000);
      },
    }),
  ];
}

/** How a delegated answer enters the caller's context: as data from another agent, with how its run ended. */
export const agentReply = (name: string, text: string, state: string) =>
  untrusted("agent_reply", { from: name, state }, cap(text));
