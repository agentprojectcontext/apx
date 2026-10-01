// Finding and asking other agents. `delegate` is the only way an agent talks to another one.
import type { Store } from "../domain/store.ts";
import { cap, untrusted } from "./result.ts";
import { obj, str, type Tool } from "./types.ts";

export const MAX_DEPTH = 2;

export function agentTools(store: Store): Tool[] {
  return [
    {
      name: "list_agents",
      description: "List agents with their ids and projects. Optional filter by project name or text in name/role.",
      parameters: obj({ query: str("project name or text to match (optional)") }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked up agents",
      async run(a) {
        const q = String(a.query ?? "").toLowerCase();
        const projects = new Map(store.projects.list().map((p) => [p.id, p.name]));
        const rows = store.agents
          .list()
          .map((x) => ({ ...x, project: x.project_id ? (projects.get(x.project_id) ?? "") : "" }))
          .filter((x) => !q || `${x.name} ${x.role} ${x.project}`.toLowerCase().includes(q))
          .slice(0, 40)
          .map((x) => `- ${x.name} (id: ${x.id})${x.project ? ` [${x.project}]` : ""}${x.role ? `: ${x.role}` : ""}`);
        return rows.length ? rows.join("\n") : "no agents match";
      },
    },
    {
      name: "delegate",
      description:
        "Ask another agent to do a task (use its id; a name works when it is unique). It works in a sub-thread the owner can open. If it answers within wait_s you get the answer now; otherwise you get the result later in a new turn: never poll for it.",
      parameters: obj(
        {
          agent: str("agent id (or unique name)"),
          task: str("clear, self-contained task with everything the other agent needs"),
          wait_s: { type: "integer", description: "seconds to wait inside this turn (0-120, default 60)" },
        },
        ["agent", "task"],
      ),
      effect: "message",
      // The wait itself is bounded by wait_s; this covers the bookkeeping around it.
      deadlineMs: 130_000,
      title: (a) => `Asked ${String(a.agent)}`,
      async run(a, ctx) {
        if (ctx.run.depth >= MAX_DEPTH) return "refused: delegation depth limit reached; do it yourself.";
        const found = store.agents.resolve(String(a.agent), ctx.thread.project_id);
        if ("error" in found) return found.error;
        if (found.agent.id === ctx.agent.id) return "refused: you cannot delegate to yourself.";
        const waitS = Math.min(120, Math.max(0, Number(a.wait_s ?? 60) || 0));
        return ctx.delegate(found.agent, String(a.task), waitS * 1000);
      },
    },
  ];
}

/** How a delegated answer enters the caller's context: as data from another agent, with how its run ended. */
export const agentReply = (name: string, text: string, state: string) =>
  untrusted("agent_reply", { from: name, state }, cap(text));
