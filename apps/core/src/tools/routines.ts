// routine_list / routine_set: the owner's routines, read and changed by their agent ("change April's prompt", "run
// the morning brief now"). A routine is standing work, so every change waits for the owner's OK
// (DECISIONS.md#d-059-routines).
import type { Routine, Schedule } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { modeOf, withProjectAutonomy } from "./policy.ts";
import { defineTool, type Tool } from "./types.ts";

const when = (s: Schedule) =>
  s.kind === "cron"
    ? `cron ${s.cron}`
    : s.kind === "every"
      ? `every ${s.minutes} min`
      : s.kind === "once"
        ? s.at
        : s.kind;

const at = (iso: string | undefined) => iso?.slice(0, 16).replace("T", " ");

/** A routine by id, or by name (any case); a name two routines share asks for the id. */
function find(store: Store, ref: string): { routine: Routine } | { error: string } {
  const byId = store.routines.get(ref);
  if (byId) return { routine: byId };
  const named = store.routines.list().filter((r) => r.name.toLowerCase() === ref.trim().toLowerCase());
  if (named.length === 1 && named[0]) return { routine: named[0] };
  if (named.length > 1) return { error: `"${ref}" names ${named.map((r) => r.id).join(", ")}; use the id` };
  return { error: `no routine "${ref}"; routine_list shows them` };
}

/** Whether an agent already works on Total, by its own mode or its project's (never a routine run's mode over it). */
const onTotal = (store: Store, id: string | undefined) => {
  const agent = id ? store.agents.get(id) : undefined;
  return !!agent && modeOf(withProjectAutonomy(store, agent)) === "total";
};

/**
 * `autonomy: "total"` on a routine whose agent is already on Total, and that holds no lower level: it gives that agent
 * nothing it lacks, so it changes nothing and asks nobody (DECISIONS.md#d-223).
 */
function sameTotal(store: Store, a: { routine?: string; agent?: string; autonomy?: string }, caller: AgentRecord) {
  if (a.autonomy !== "total") return false;
  const found = a.routine ? find(store, a.routine) : undefined;
  if (found && "error" in found) return false;
  const was = found?.routine;
  if (was?.autonomy && was.autonomy !== "total") return false;
  const named = a.agent ? store.agents.resolve(a.agent, caller.project_id) : undefined;
  if (named && "error" in named) return false;
  return onTotal(store, named?.agent.id ?? was?.agent_id ?? caller.id);
}

function line(store: Store, r: Routine): string {
  const project = r.project_id ? (store.projects.get(r.project_id)?.name ?? r.project_id) : "";
  const bits = [
    `agent ${r.agent_id}`,
    project ? `project ${project}` : "",
    when(r.schedule),
    r.autonomy ? `acts ${r.autonomy}` : "",
    r.enabled ? "on" : "off",
    r.last_run_at ? `last ${at(r.last_run_at)}` : "",
    r.enabled && r.next_run_at ? `next ${at(r.next_run_at)}` : "",
  ];
  return `- ${r.name} [${r.id}] (${bits.filter(Boolean).join(", ")})`;
}

export function routineTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "routine_list",
      description:
        "List the owner's routines (scheduled jobs), global and per project: name, id, agent, project, when it runs, on or off, last and next run. `routine` (id or name) shows that one with its full prompt.",
      args: z.object({ routine: z.string().trim().min(1).max(120).optional() }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => (a.routine ? `Looked at the routine ${a.routine}` : "Looked at the routines"),
      async run(a) {
        if (a.routine) {
          const found = find(store, a.routine);
          if ("error" in found) return found.error;
          const r = found.routine;
          const extra = [r.action !== "agent" ? `action: ${r.action}` : "", r.pre_command ? "has a pre-command" : ""];
          return [line(store, r), ...extra.filter(Boolean), "prompt:", r.prompt].join("\n");
        }
        const all = store.routines.list();
        return all.length ? all.map((r) => line(store, r)).join("\n") : "no routines.";
      },
    }),
    defineTool({
      name: "routine_set",
      description:
        "Create a routine (name, prompt, one of cron/every_min/at) or change one (routine: id/name; only what you give changes; a prompt replaces it whole). run_now: also runs it. autonomy only if the owner asks (agent: its agent's). Asks the owner: one call.",
      args: z.object({
        routine: z.string().trim().min(1).max(120).optional().describe("omit to create one"),
        name: z.string().trim().min(1).max(120).optional(),
        prompt: z.string().trim().min(1).max(20_000).optional(),
        cron: z.string().trim().min(9).max(120).optional().describe('five fields, local time: "30 8 * * 1-5"'),
        every_min: z.number().int().min(5).max(44_640).optional(),
        at: z.string().max(40).optional().describe("ISO date: runs once then"),
        agent: z.string().trim().min(1).max(120).optional().describe("id or name; default you"),
        autonomy: z.enum(["manual", "auto", "total", "agent"]).optional(),
        enabled: z.boolean().optional(),
        run_now: z.boolean().optional(),
      }),
      effect: "local",
      confirm: "always",
      // Only an agent on Total may ask for Total, and giving it to an agent that lacks it is the owner's own choice,
      // whatever this agent's mode (DECISIONS.md#d-223).
      check: (a, ctx) => {
        if (a.autonomy === "total" && !onTotal(store, ctx.agent.id))
          throw new Error("only the owner sets a routine to total, in its editor; leave autonomy out");
      },
      keepsCard: (a, agent) => (a.autonomy === "total" && !sameTotal(store, a, agent) ? "card" : undefined),
      deadlineMs: 15_000,
      title: (a) => (a.routine ? `Changed the routine ${a.routine}` : `Created the routine ${a.name ?? ""}`),
      async run(a, ctx) {
        if (!ctx.callAsOwner) return "not run: the owner did not approve it";
        const given = [a.cron, a.every_min, a.at].filter((x) => x !== undefined).length;
        if (given > 1) return "give one of cron, every_min or at";
        const schedule: Schedule | undefined = a.cron
          ? { kind: "cron", cron: a.cron }
          : a.every_min
            ? { kind: "every", minutes: a.every_min }
            : a.at
              ? { kind: "once", at: a.at }
              : undefined;
        let was: Routine | undefined;
        if (a.routine) {
          const found = find(store, a.routine);
          if ("error" in found) return found.error;
          was = found.routine;
        }
        let agent = was ? store.agents.get(was.agent_id) : ctx.agent;
        if (a.agent) {
          const found = store.agents.resolve(a.agent, ctx.thread.project_id);
          if ("error" in found) return found.error;
          agent = found.agent;
        }
        if (!agent) return `no agent ${was?.agent_id ?? ""}`;
        const autonomy = sameTotal(store, a, ctx.agent) ? undefined : a.autonomy;
        const name = a.name ?? was?.name;
        const prompt = a.prompt ?? was?.prompt;
        const next = schedule ?? was?.schedule;
        if (!name || !prompt || !next) return "a new routine needs name, prompt and one of cron, every_min or at";
        const changes = a.name || a.prompt || schedule || a.agent || a.enabled !== undefined || autonomy;
        let r = was;
        if (!was || changes)
          r = await ctx.callAsOwner("routines.set", {
            ...(was ? { id: was.id } : {}),
            name,
            agent: agent.id,
            ...(was?.project_id || agent.project_id || ctx.thread.project_id
              ? { project: was?.project_id ?? agent.project_id ?? ctx.thread.project_id }
              : {}),
            schedule: next,
            prompt,
            ...(autonomy ? { autonomy: autonomy === "agent" ? null : autonomy } : {}),
            enabled: a.enabled ?? was?.enabled ?? true,
          });
        if (!r) return "nothing to change";
        const saved = changes || !was ? `saved: ${line(store, store.routines.get(r.id) ?? r)}` : line(store, r);
        if (!a.run_now) return saved;
        const run = await ctx.callAsOwner("routines.run", { routine: r.id });
        return `${saved}\nrunning now in thread ${run.thread_id}; its answer reaches the owner like any run of it.`;
      },
    }),
  ];
}
