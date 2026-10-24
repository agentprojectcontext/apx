// routine_list / routine_set: the owner's routines, read and changed by their agent ("change April's prompt", "run
// the morning brief now"). A routine is standing work, so every change waits for the owner's OK (DECISIONS.md#d-059).
import type { Routine, Schedule } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
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

function line(store: Store, r: Routine): string {
  const project = r.project_id ? (store.projects.get(r.project_id)?.name ?? r.project_id) : "";
  const bits = [
    `agent ${r.agent_id}`,
    project ? `project ${project}` : "",
    when(r.schedule),
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
        "Create a routine (name, prompt, one of cron/every_min/at) or change one (routine: id or name; only what you give changes; prompt replaces it whole: read it with routine_list). enabled: on/off; run_now: run it now, also on create or change. Each change waits for the owner's OK, so make it one call.",
      args: z.object({
        routine: z.string().trim().min(1).max(120).optional().describe("omit to create one"),
        name: z.string().trim().min(1).max(120).optional(),
        prompt: z.string().trim().min(1).max(20_000).optional(),
        cron: z.string().trim().min(9).max(120).optional().describe('five fields, local time: "30 8 * * 1-5"'),
        every_min: z.number().int().min(5).max(44_640).optional(),
        at: z.string().max(40).optional().describe("ISO date: runs once then"),
        agent: z.string().trim().min(1).max(120).optional().describe("id or name; default you"),
        enabled: z.boolean().optional(),
        run_now: z.boolean().optional(),
      }),
      effect: "local",
      confirm: "always",
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
        const name = a.name ?? was?.name;
        const prompt = a.prompt ?? was?.prompt;
        const next = schedule ?? was?.schedule;
        if (!name || !prompt || !next) return "a new routine needs name, prompt and one of cron, every_min or at";
        const changes = a.name || a.prompt || schedule || a.agent || a.enabled !== undefined;
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
