// The only tools a contact's chat can ever have, each behind a flag the owner turns on for that person (all off by
// default). They never act for the owner: one leaves a task for the owner to look at, the other reads the owner's own
// global notes. See DECISIONS.md#d-022
import type { PersonPerms } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { defineTool, type Tool } from "./types.ts";

/** Requests one contact may leave waiting for the owner at a time: their chat cannot flood the owner's tasks. */
const OPEN_REQUESTS_PER_PERSON = 5;

export const CONTACT_TOOLS: ReadonlySet<string> = new Set(["pass_request", "search_owner_notes"]);

/** Which of them a contact's turn gets, from that person's flags. */
export function contactToolNames(perms: PersonPerms | undefined): Set<string> {
  const names = new Set<string>();
  if (perms?.requests || perms?.appointments) names.add("pass_request");
  if (perms?.notes) names.add("search_owner_notes");
  return names;
}

export function contactTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "pass_request",
      description:
        "Leave a request from the person you are chatting with for your owner: a purchase, a favor, an appointment. It becomes a task your owner will look at and confirm; it does not do anything by itself. Tell the person you passed it on, never that it is done.",
      args: z.object({
        kind: z.enum(["request", "appointment"]),
        summary: z.string().trim().min(3).max(160).describe("what they ask, in a few words"),
        when: z.string().trim().max(80).optional().describe("for an appointment: the day and time they ask for"),
        details: z.string().trim().max(1000).optional(),
      }),
      // Only a task for the owner, who decides; capped per person and contacts are rate-limited upstream.
      effect: "local",
      confirm: "never",
      deadlineMs: 10_000,
      title: (a) => `Passed on: ${String(a.summary ?? "").slice(0, 80)}`,
      async run(a, ctx) {
        const personId = ctx.thread.channel?.person_id;
        const person = personId ? store.persons.get(personId) : undefined;
        if (!person) throw new Error("this chat is not with a known contact");
        // The flag is checked again here: the tool list is built per turn, the owner may have just turned it off.
        const allowed = a.kind === "appointment" ? person.perms.appointments : person.perms.requests;
        if (!allowed) throw new Error(`your owner does not take ${a.kind}s from ${person.name} here`);
        const waiting = store.tasks
          .list({ person: person.id, state: "open", limit: 50 })
          .filter((t) => t.awaits_owner).length;
        if (waiting >= OPEN_REQUESTS_PER_PERSON)
          throw new Error(
            `${person.name} already has ${waiting} requests waiting for your owner; say they will be looked at`,
          );
        const label = a.kind === "appointment" ? "Appointment" : "Request";
        const task = await ctx.call("tasks.create", {
          title: `${label} from ${person.name}: ${a.summary}`.slice(0, 200),
          ...(a.details || a.when
            ? { description: [a.when ? `When: ${a.when}` : "", a.details ?? ""].filter(Boolean).join("\n") }
            : {}),
          person: person.id,
          owed_by: "owner",
        });
        await ctx.call("tasks.update", { task: task.id, awaits_owner: true });
        return `passed on to your owner as a task (${task.id}); they will confirm.`;
      },
    }),
    defineTool({
      name: "search_owner_notes",
      description:
        "Search the notes your owner wrote (their general notes only) to answer the person you are chatting with. Share only what answers their question; never anything private they did not ask about.",
      args: z.object({ query: z.string().trim().min(2).max(200) }),
      effect: "none",
      confirm: "never",
      deadlineMs: 5_000,
      title: (a) => `Searched your notes for "${String(a.query ?? "").slice(0, 60)}"`,
      async run(a, ctx) {
        const personId = ctx.thread.channel?.person_id;
        if (!personId || !store.persons.get(personId)?.perms.notes) throw new Error("not allowed in this chat");
        const { memories } = await ctx.call("memory.list", { query: a.query, scope: "global", limit: 8 });
        // The owner's own words only: never what an agent saved, and never a note saved with outside content.
        const mine = memories.filter((m) => m.source === "owner" && !m.tainted);
        return mine.length ? mine.map((m) => `- ${m.text.replace(/\s+/g, " ")}`).join("\n") : "no notes match.";
      },
    }),
  ];
}
