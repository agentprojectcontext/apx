// routine_list / contact_list: what the owner set up, read by their agent ("what routines do I have?", "who is
// Alex?"). Read only: running, changing or removing a routine, and adding or forgetting a contact, stay the
// owner's acts (their methods are human-only).
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { defineTool, type Tool } from "./types.ts";

const when = (s: { kind: string; cron?: string; hours?: number; minutes?: number; at?: string }) =>
  s.kind === "cron"
    ? `cron ${s.cron}`
    : s.kind === "every"
      ? `every ${s.hours ?? s.minutes} ${s.hours ? "h" : "min"}`
      : String(s.at ?? s.kind);

export function directoryTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "routine_list",
      description:
        "List the owner's routines (scheduled jobs): name, agent, project, when it runs, on or off, last and next run. To run, change or turn one off, the owner does it in Routines (or `apx routines`): say so.",
      args: z.object({}),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at the routines",
      async run() {
        const all = store.routines.list(null);
        if (!all.length) return "no routines.";
        const projects = new Map(store.projects.list(false).map((p) => [p.id, p.name]));
        return all
          .map(
            (r) =>
              `- ${r.name} (${[
                `agent ${r.agent_id}`,
                r.project_id ? `project ${projects.get(r.project_id) ?? r.project_id}` : "",
                when(r.schedule as Parameters<typeof when>[0]),
                r.enabled ? "on" : "off",
                r.last_run_at ? `last ${r.last_run_at.slice(0, 16).replace("T", " ")}` : "",
                r.enabled && r.next_run_at ? `next ${r.next_run_at.slice(0, 16).replace("T", " ")}` : "",
              ]
                .filter(Boolean)
                .join(", ")})`,
          )
          .join("\n");
      },
    }),
    defineTool({
      name: "contact_list",
      description:
        "Find the owner's contacts: their names, nicknames, relation, the channels each one is on and the owner's note about them. `query` narrows by name. Use it before writing to someone (message_contact) when you are not sure who they are.",
      args: z.object({ query: z.string().trim().max(80).optional() }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at the contacts",
      async run(a) {
        const q = a.query?.toLowerCase();
        const people = store.persons
          .list()
          .filter((p) => p.role === "contact")
          .filter((p) => !q || p.name.toLowerCase().includes(q) || p.nickname?.toLowerCase().includes(q));
        if (!people.length) return q ? `no contact matches "${a.query}".` : "no contacts yet.";
        return people
          .slice(0, 50)
          .map((p) => {
            const on = [...new Set(p.addresses.map((x) => x.channel))].join(", ") || "no channel";
            const bits = [p.nickname ? `"${p.nickname}"` : "", p.relation ?? "", `on ${on}`, p.muted ? "silenced" : ""];
            return `- ${p.name} [${p.id}] (${bits.filter(Boolean).join(", ")})${p.note ? `: ${p.note.slice(0, 200)}` : ""}`;
          })
          .join("\n");
      },
    }),
  ];
}
