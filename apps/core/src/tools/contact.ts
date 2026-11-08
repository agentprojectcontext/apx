// The only tools a contact's chat can ever have, each behind a right the owner turns on for that person or for every
// contact of the account (all off by default). They never act for the owner: one leaves a task for the owner to look at, the other reads the owner's own
// global notes. See DECISIONS.md#d-022
import { type ContactRights, methods, type Person, type PersonRelation, type Task } from "@apx/protocol";
import { z } from "zod";
import { contactRights } from "../domain/contact-rights.ts";
import type { Store } from "../domain/store.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

/** Requests one contact may leave waiting for the owner at a time: their chat cannot flood the owner's tasks. */
const OPEN_REQUESTS_PER_PERSON = 5;
/** What a contact may leave for the owner: a request, an appointment, or a message to pass on. */
const KINDS = ["request", "appointment", "message"] as const;
type Kind = (typeof KINDS)[number];

/** Only the request originally submitted here, never the owner's later task notes. */
function submittedRequest(store: Store, task: Task, thread: string) {
  const created = store.tasks.events(task.id).find((e) => e.op === "create" && e.data.from_thread === thread);
  const run = typeof created?.data.from_run === "string" ? store.runs.get(created.data.from_run) : undefined;
  if (!run || run.thread_id !== thread) return undefined;
  const step = store.runs
    .steps(run.id)
    .find((s) => s.tool === "pass_request" && s.state === "ok" && s.result?.includes(task.id));
  const kind = KINDS.find((k) => k === step?.args.kind);
  if (!step || !kind) return undefined;
  return {
    task: task.id,
    kind,
    summary: step.args.summary,
    when: step.args.when,
    details: step.args.details,
    created_at: task.created_at,
  };
}

export const CONTACT_TOOLS: ReadonlySet<string> = new Set(["pass_request", "search_owner_notes"]);

/** People close enough that a message they leave for the owner always reaches them (DECISIONS.md#d-149). */
const CLOSE: ReadonlySet<PersonRelation> = new Set(["partner", "family", "friend"]);

/** A contact as their chat's tools see them: their rights on the account they write on, and how they relate. */
type Holder = { rights: ContactRights; relation?: PersonRelation | undefined };

/** Whether this person may leave that kind of request for the owner. */
function mayPass(who: Holder, kind: Kind): boolean {
  if (kind === "appointment") return who.rights.appointments;
  if (kind === "request") return who.rights.requests;
  return who.rights.requests || (who.relation !== undefined && CLOSE.has(who.relation));
}

/** Which of them a contact's turn gets, from their rights on the account and their relation. */
export function contactToolNames(who: Holder | undefined): Set<string> {
  const names = new Set<string>();
  if (who && KINDS.some((k) => mayPass(who, k))) names.add("pass_request");
  if (who?.rights.notes) names.add("search_owner_notes");
  return names;
}

/** A turn's contact as their tools see them; none for the owner or a room. */
export const contactHolder = (audience: {
  kind: string;
  rights?: ContactRights | undefined;
  person?: Pick<Person, "relation"> | undefined;
}): Holder | undefined =>
  audience.kind === "contact" && audience.rights
    ? { rights: audience.rights, relation: audience.person?.relation }
    : undefined;

/** The person this chat is with, and what they may do on its account (checked again on each call). */
function holderIn(store: Store, thread: { channel?: { id: string; person_id?: string | undefined } | undefined }) {
  const personId = thread.channel?.person_id;
  const person: Person | undefined = personId ? store.persons.get(personId) : undefined;
  if (!person || !thread.channel) return undefined;
  return { person, rights: contactRights(store, person, thread.channel.id), relation: person.relation };
}

export function contactTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "pass_request",
      description:
        "Pass a contact's request to your owner (kind message: something they want your owner to know or do, like calling someone back or contacting someone they shared). First omit task to check existing requests. If matches are returned, compare with this conversation: use their task id for the same request (confirmation, changed time, extra details); task:null only for a genuinely new request. Never merge unrelated requests. This leaves or updates a task, never performs the request. Tell the person it was passed on, not done.",
      args: z.object({
        kind: z.enum(KINDS),
        summary: z.string().trim().min(3).max(160).describe("what they ask, in a few words"),
        when: z.string().trim().max(80).optional().describe("for an appointment: the day and time they ask for"),
        details: z.string().trim().max(1000).optional(),
        task: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("omit to check; existing id to update; null for a new, unrelated request"),
      }),
      // Only a task for the owner, who decides; capped per person and contacts are rate-limited upstream.
      effect: "local",
      confirm: "never",
      deadlineMs: 10_000,
      title: (a) =>
        `${a.task === undefined ? "Checked requests" : a.task ? "Updated request" : "Passed on"}: ${String(a.summary ?? "").slice(0, 80)}`,
      async run(a, ctx) {
        const who = holderIn(store, ctx.thread);
        if (!who) throw new Error("this chat is not with a known contact");
        const { person } = who;
        // The right is checked again here: the tool list is built per turn, the owner may have just turned it off.
        if (!mayPass(who, a.kind)) throw new Error(`your owner does not take ${a.kind}s from ${person.name} here`);
        const eligible = (t: Task) =>
          t.person_id === person.id &&
          t.state === "open" &&
          t.kind === "commitment" &&
          t.owed_by === "owner" &&
          !t.project_id;
        const requests = store.tasks
          .list({ person: person.id, state: "open", from_thread: ctx.thread.id, limit: 50 })
          .filter(eligible)
          .flatMap((t) => submittedRequest(store, t, ctx.thread.id) ?? [])
          .filter((r) => mayPass(who, r.kind));
        const checked = store.runs
          .steps(ctx.run.id)
          .some((s) => s.tool === "pass_request" && s.state === "ok" && s.result?.startsWith("No task changed."));
        if (requests.length && (a.task === undefined || (a.task === null && !checked)))
          return `No task changed. Compare these requests with the conversation. Call pass_request again with the matching task id and current summary; use task:null only for an unrelated new request.\n${untrusted("contact_requests", {}, JSON.stringify(requests))}`;
        const label = { appointment: "Appointment", request: "Request", message: "Message" }[a.kind];
        const title = `${label} from ${person.name}: ${a.summary}`.slice(0, 200);
        const description = [a.when ? `When: ${a.when}` : "", a.details ?? ""].filter(Boolean).join("\n");
        if (a.task) {
          const existing = store.tasks.get(a.task);
          const submitted =
            existing && eligible(existing) ? submittedRequest(store, existing, ctx.thread.id) : undefined;
          if (!existing || !submitted || submitted.kind !== a.kind)
            throw new Error("not updated: choose an open request of the same kind submitted in this contact's chat");
          const update = [a.summary, description].filter(Boolean).join("\n");
          const combined = existing.description.endsWith(update)
            ? existing.description
            : [existing.description, `Update:\n${update}`].filter(Boolean).join("\n\n");
          const fits = methods["tasks.update"].params.shape.description.safeParse(combined).success;
          if (!fits)
            // Quoted contact text cannot trigger task mentions, including requests for the owner's attention.
            await ctx.call("tasks.comment", {
              task: existing.id,
              text: untrusted("contact_request_update", {}, update.replaceAll("@", "&#64;")),
            });
          await ctx.call("tasks.update", {
            task: existing.id,
            title,
            ...(fits ? { description: combined } : {}),
            awaits_owner: true,
          });
          return `updated your owner's existing task (${existing.id}); they will confirm.`;
        }
        const waiting = store.tasks
          .list({ person: person.id, state: "open", limit: 50 })
          .filter((t) => t.awaits_owner).length;
        if (waiting >= OPEN_REQUESTS_PER_PERSON)
          throw new Error(
            `${person.name} already has ${waiting} requests waiting for your owner; say they will be looked at`,
          );
        const task = await ctx.call("tasks.create", {
          title,
          ...(description ? { description } : {}),
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
        if (!holderIn(store, ctx.thread)?.rights.notes) throw new Error("not allowed in this chat");
        const { memories } = await ctx.call("memory.list", { query: a.query, scope: "global", limit: 40 });
        // The owner's own words only: never what an agent saved, and never a note saved with outside content.
        const mine = memories.filter((m) => m.source === "owner" && !m.tainted).slice(0, 8);
        return mine.length ? mine.map((m) => `- ${m.text.replace(/\s+/g, " ")}`).join("\n") : "no notes match.";
      },
    }),
  ];
}
