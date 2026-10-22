// Google Calendar, Gmail and Drive as APX tools, offered only while the owner's account is connected and on in the
// thread's project (Tool.when). What other people wrote (events they invited to, mail, files) comes back as outside
// data. An event only on the owner's calendar needs no OK; inviting people, cancelling and writing a draft are strong
// actions that ask (DECISIONS.md#d-130); sending mail always waits for the owner. Gmail's reading tools need the
// owner's own client; APX's own client only sends (gmail_send).
import { z } from "zod";
import { calendarApi } from "../integrations/calendar.ts";
import { gmailApi } from "../integrations/gmail.ts";
import type { Google } from "../integrations/google.ts";
import { driveTools } from "./google-drive.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

/** A moment with its offset ("2026-05-04T15:00:00-03:00"). */
const Moment = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, "RFC 3339 with offset");
/** A moment (the offset or time_zone says where), or a day for an all-day event. */
const Time = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, "RFC 3339, or YYYY-MM-DD");
const Emails = z.array(z.email()).max(50);
/** A header's text: one line. */
const Line = z
  .string()
  .max(300)
  .regex(/^[^\r\n]*$/, "one line");

const lines = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");

export function googleTools(g: Google | undefined): Tool[] {
  if (!g) return [];
  const cal = calendarApi(g);
  const mail = gmailApi(g);
  const onCalendar = (t: { project_id?: string | undefined }) => g.usable("google-calendar", t.project_id);
  // Reading and drafts need the owner's own client; APX's own can only send.
  const onGmail = (t: { project_id?: string | undefined }) => g.usable("gmail", t.project_id) && g.full("gmail");
  const onGmailSend = (t: { project_id?: string | undefined }) => g.usable("gmail", t.project_id) && !g.full("gmail");
  return [
    defineTool({
      name: "calendar_events",
      description: "List the owner's Google Calendar events between two moments (RFC 3339 with offset), oldest first.",
      args: z.object({
        from: Moment,
        to: Moment,
        q: z.string().max(200).optional().describe("words to match"),
        max: z.number().int().min(1).max(100).default(25),
      }),
      effect: "none",
      deadlineMs: 30_000,
      when: onCalendar,
      title: () => "Read the calendar",
      async run(a) {
        const r = await cal.list({ ...a, calendar: "primary" });
        if (!r.events.length) return "no events in that range";
        // Invitations carry other people's titles and descriptions.
        return untrusted("calendar", r.timeZone ? { time_zone: r.timeZone } : {}, lines(r.events));
      },
    }),
    defineTool({
      name: "calendar_free",
      description: "The owner's busy blocks and free gaps of at least `minutes` between two moments.",
      args: z.object({
        from: Moment,
        to: Moment,
        minutes: z.number().int().min(5).max(1440).default(30),
        limit: z.number().int().min(1).max(20).default(5),
      }),
      effect: "none",
      deadlineMs: 30_000,
      when: onCalendar,
      title: () => "Looked for free time",
      async run(a) {
        const r = await cal.free({ ...a, calendar: "primary" });
        return JSON.stringify(r);
      },
    }),
    defineTool({
      name: "calendar_create_event",
      description:
        "Create an event on the owner's Google Calendar (the owner is its organizer). Attendees get an invitation from the owner; meet adds a Google Meet link. Check calendar_free first; when people should come and you lack their email or a time that suits them, ask them, then create it (or add them later with calendar_update_event).",
      args: z.object({
        title: Line,
        start: Time,
        end: Time,
        time_zone: z.string().max(64).optional().describe("IANA zone, for times without offset"),
        description: z.string().max(8000).optional(),
        location: Line.optional(),
        attendees: Emails.optional(),
        meet: z.boolean().optional(),
      }),
      effect: "external",
      // Only on the owner's calendar it is theirs; an invitation speaks to other people in their name.
      confirm: (a) => (a.attendees?.length ? "ask" : "never"),
      deadlineMs: 30_000,
      when: onCalendar,
      title: (a) => `Created the event ${a.title ?? ""}`.trim(),
      async run(a) {
        return JSON.stringify(await cal.create({ ...a, calendar: "primary" }));
      },
    }),
    defineTool({
      name: "calendar_update_event",
      description:
        "Change an event of the owner's Google Calendar by id (from calendar_events or calendar_create_event); only what is given changes. Attendees hear about it.",
      args: z.object({
        id: z.string().min(1).max(1024),
        title: Line.optional(),
        start: Time.optional(),
        end: Time.optional(),
        time_zone: z.string().max(64).optional(),
        description: z.string().max(8000).optional(),
        location: Line.optional(),
        add_attendees: Emails.optional().describe("invite these too"),
        remove_attendees: Emails.optional(),
        attendees: Emails.optional().describe("the whole new list, instead of add/remove"),
        meet: z.boolean().optional().describe("add a Google Meet link"),
      }),
      effect: "external",
      confirm: (a) => (a.add_attendees?.length || a.attendees?.length ? "ask" : "never"),
      deadlineMs: 30_000,
      when: onCalendar,
      title: (a) => (a.title ? `Changed the event ${a.title}` : "Changed an event"),
      async run(a) {
        return JSON.stringify(await cal.update({ ...a, calendar: "primary" }));
      },
    }),
    defineTool({
      name: "calendar_cancel_event",
      description: "Cancel (delete) an event of the owner's Google Calendar by id; its attendees are told.",
      args: z.object({ id: z.string().min(1).max(1024) }),
      effect: "external",
      confirm: "ask",
      deadlineMs: 30_000,
      when: onCalendar,
      title: () => "Cancelled an event",
      async run(a) {
        const was = await cal.get({ ...a, calendar: "primary" });
        await cal.cancel({ ...a, calendar: "primary" });
        return `cancelled ${was.title} (${was.start ?? "no start"})`;
      },
    }),
    defineTool({
      name: "gmail_search",
      description: "Search the owner's Gmail with Gmail's query syntax (from:, is:unread, newer_than:2d…).",
      args: z.object({ q: z.string().max(500), max: z.number().int().min(1).max(25).default(10) }),
      effect: "none",
      deadlineMs: 30_000,
      when: onGmail,
      title: (a) => (a.q ? `Searched mail for ${a.q}` : "Searched mail"),
      async run(a) {
        const found = await mail.search(a);
        if (!found.length) return "no messages";
        return untrusted("emails", { q: a.q }, lines(found));
      },
    }),
    defineTool({
      name: "gmail_read",
      description: "Read one of the owner's Gmail messages by id (from gmail_search).",
      args: z.object({ id: z.string().min(1).max(200) }),
      effect: "none",
      deadlineMs: 30_000,
      when: onGmail,
      title: () => "Read an email",
      async run(a) {
        const m = await mail.read(a.id);
        const head = [
          `From: ${m.from}`,
          ...(m.to ? [`To: ${m.to}`] : []),
          ...("cc" in m && m.cc ? [`Cc: ${m.cc}`] : []),
          `Date: ${m.date}`,
          `Subject: ${m.subject}`,
          ...(m.attachments.length ? [`Attachments: ${m.attachments.join(", ")}`] : []),
        ];
        return untrusted("email", { id: m.id, thread: m.thread }, `${head.join("\n")}\n\n${m.body}`);
      },
    }),
    defineTool({
      name: "gmail_draft",
      description:
        "Write a draft in the owner's Gmail (it is not sent). With reply_to (a message id) it is a reply in that thread.",
      args: z.object({
        to: Emails.min(1),
        cc: Emails.optional(),
        subject: Line.optional().describe("required unless reply_to"),
        body: z.string().min(1).max(20_000),
        reply_to: z.string().max(200).optional(),
      }),
      effect: "external",
      confirm: "ask",
      deadlineMs: 30_000,
      when: onGmail,
      title: (a) => (a.subject ? `Drafted ${a.subject}` : "Drafted an email"),
      async run(a) {
        if (!a.subject && !a.reply_to) throw new Error("a draft needs a subject (or reply_to)");
        const d = await mail.draft(a);
        return `draft ${d.draft} saved in Gmail (subject: ${d.subject}); it is not sent`;
      },
    }),
    defineTool({
      name: "gmail_send_draft",
      description: "Send a Gmail draft by its id (from gmail_draft). The owner confirms it first.",
      args: z.object({ draft: z.string().min(1).max(200) }),
      effect: "external",
      // It speaks as the owner to other people: it always waits for their OK.
      confirm: "always",
      deadlineMs: 30_000,
      when: onGmail,
      title: () => "Sent an email",
      async run(a) {
        const r = await mail.sendDraft(a.draft);
        return `sent (message ${r.message})`;
      },
    }),
    defineTool({
      name: "gmail_send",
      description:
        "Send an email from the owner's Gmail. The owner confirms it first. (This sign-in cannot read mail; replies arrive through the Email channel if it is set up.)",
      args: z.object({
        to: Emails.min(1),
        cc: Emails.optional(),
        subject: Line,
        body: z.string().min(1).max(20_000),
      }),
      effect: "external",
      // It speaks as the owner to other people: it always waits for their OK.
      confirm: "always",
      deadlineMs: 30_000,
      when: onGmailSend,
      title: (a) => (a.subject ? `Sent ${a.subject}` : "Sent an email"),
      async run(a) {
        const r = await mail.send(a);
        return `sent (message ${r.message})`;
      },
    }),
    ...driveTools(g),
  ];
}
