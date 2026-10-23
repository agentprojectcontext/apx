// contact_list / channel_list: what the owner set up, read by their agent ("who is Alex?", "can you reach Discord?").
// Read only: adding or forgetting a contact and setting up a channel stay the owner's acts (their methods are
// human-only). attention_hours is the one change made from chat: the super-agent's, each one once the owner says yes.
// Routines are in routines.ts.
import { ChannelHours, type Person } from "@apx/protocol";
import { z } from "zod";
import { ownerTimeZone } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";
import { inlineName } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

/** What a room's mode means for the agent reading the list. */
const ROOM_MODE = {
  always: "answers everyone",
  mention: "answers when called",
  useful: "answers when useful",
  read: "reads only",
} as const;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Fri 09:00–18:00", runs of three days or more as a range. */
export function hoursText(h: ChannelHours): string {
  const days = [...new Set(h.days)].sort();
  const runs: number[][] = [];
  for (const d of days) {
    const last = runs.at(-1);
    if (last && last.at(-1) === d - 1) last.push(d);
    else runs.push([d]);
  }
  const named = runs
    .flatMap((r) => (r.length > 2 ? [`${DAYS[r[0] ?? 0]}–${DAYS[r.at(-1) ?? 0]}`] : r.map((d) => DAYS[d])))
    .join(", ");
  return `${days.length === 7 ? "every day" : named} ${h.from === h.to ? "all day" : `${h.from}–${h.to}`}`;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** A contact by id, name or nickname; a name two contacts share is an error, never a guess. */
function contactOf(store: Store, ref: string): Person | string {
  const people = store.persons.list().filter((p) => p.role === "contact");
  const byId = people.find((p) => p.id === ref);
  if (byId) return byId;
  const q = fold(ref);
  const exact = people.filter((p) => fold(p.name) === q || (p.nickname && fold(p.nickname) === q));
  const hits = exact.length
    ? exact
    : people.filter((p) => fold(p.name).includes(q) || (p.nickname && fold(p.nickname).includes(q)));
  if (hits.length === 1 && hits[0]) return hits[0];
  if (hits.length > 1)
    return `"${ref}" matches ${hits.map((p) => `${inlineName(p.name)} [${p.id}]`).join(", ")}; use the id`;
  return `no contact "${ref}": contact_list shows them`;
}

export function directoryTools(store: Store): Tool[] {
  /** A channel by id or name; its type ("whatsapp") only while one channel has it. */
  const channelOf = (ref: string) => {
    const q = fold(ref);
    const all = store.settings.read("channels");
    const ofType = all.filter((c) => c.type === q);
    return all.find((c) => c.id === ref || fold(c.label ?? "") === q) ?? (ofType.length === 1 ? ofType[0] : undefined);
  };
  const hoursArgs = z.object({
    channel: z.string().trim().min(1).max(60).optional().describe("id or name, as channel_list shows it"),
    hours: ChannelHours.nullable()
      .optional()
      .describe("days 0 = Sunday, from/to HH:MM in the owner's time zone; null: answer at any hour"),
    contacts: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe("ids or names (contact_list)"),
    any_hour: z.boolean().optional().describe("true: these contacts are answered at any hour; false: they wait too"),
  });
  type HoursArgs = z.output<typeof hoursArgs>;
  const changes = (a: HoursArgs) => a.hours !== undefined || (a.any_hour !== undefined && !!a.contacts?.length);
  /** What the owner approves, in words: the channel's new hours and who passes them. */
  const explain = (a: HoursArgs) => {
    const ch = a.channel ? channelOf(a.channel) : undefined;
    const tz = ownerTimeZone(store) ?? "this computer's time zone";
    const people = (a.contacts ?? [])
      .map((c) => contactOf(store, c))
      .map((p) => (typeof p === "string" ? p : inlineName(p.name)));
    return [
      a.hours === undefined
        ? ""
        : `${ch?.label ?? a.channel}: ${a.hours ? `answers contacts ${hoursText(a.hours)} (${tz}); outside them they wait until the hours begin` : "answers contacts at any hour"}`,
      a.any_hour === undefined || !people.length
        ? ""
        : `${a.any_hour ? "Answered at any hour" : "Wait for the hours like everyone"}: ${people.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");
  };
  return [
    defineTool({
      name: "channel_list",
      description:
        "List the channels APX talks through for the owner (WhatsApp, Telegram, Discord, Slack…), whether each is up, and its rooms: shared places inside a channel, such as a Discord #channel, as opposed to contacts, who are people (contact_list). Check it before saying you cannot reach a channel or a room.",
      args: z.object({}),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at the channels",
      async run(_a, ctx) {
        const { channels } = await ctx.call("channels.overview", {});
        if (!channels.length) return "no channels set up: the owner adds them in Settings, Channels.";
        const rows = channels.map((c) => {
          const rooms = c.rooms.map((r) => `#${r.name} (${ROOM_MODE[r.mode]})`).join(", ");
          return `- ${c.label} (${c.type}): ${c.status}${rooms ? `; rooms: ${rooms}` : ""}`;
        });
        return [
          ...rows,
          'Write to people with message_contact (contact_list finds them). Read a room with read_chat("#name"); post in it with channel_post.',
        ].join("\n");
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
            const nick = p.nickname ? inlineName(p.nickname) : "";
            const bits = [
              nick ? `"${nick}"` : "",
              p.relation ?? "",
              `on ${on}`,
              p.muted ? "silenced" : p.supervised ? "supervised: the owner approves each answer" : "",
              p.any_hour ? "answered at any hour" : "",
            ];
            // A contact's name is the one they gave on their app: one plain line, so it cannot add contacts or orders.
            return `- ${inlineName(p.name) || "someone"} [${p.id}] (${bits.filter(Boolean).join(", ")})${p.note ? `: ${p.note.slice(0, 200)}` : ""}`;
          })
          .join("\n");
      },
    }),
    defineTool({
      name: "attention_hours",
      description:
        "When each channel answers the owner's contacts (the owner is always answered), and which contacts are answered at any hour. No args: read them. hours: set a channel's; contacts + any_hour: let them through outside the hours, or not.",
      args: hoursArgs,
      effect: "local",
      // Who reaches the owner, and when, is theirs to decide: each change waits for their yes.
      confirm: (a) => (changes(a) ? "always" : "never"),
      ownerSetting: changes,
      deadlineMs: 15_000,
      explain,
      title: (a) =>
        a.hours !== undefined
          ? `Set the hours of ${a.channel ?? "a channel"}`
          : a.contacts?.length && a.any_hour !== undefined
            ? `${a.any_hour ? "Let through" : "Stopped letting through"} ${a.contacts.join(", ").slice(0, 60)}`
            : "Looked at the attention hours",
      // Before the owner is asked: nobody approves hours for a channel or a contact that is not there.
      check(a) {
        if (a.hours !== undefined && !a.channel) throw new Error("say which channel the hours are for");
        if (a.channel && !channelOf(a.channel)) throw new Error(`no channel "${a.channel}": channel_list shows them`);
        if (a.contacts?.length && a.any_hour === undefined)
          throw new Error("any_hour: true to answer them at any hour, false to make them wait for the hours");
        for (const c of a.contacts ?? []) {
          const p = contactOf(store, c);
          if (typeof p === "string") throw new Error(p);
        }
      },
      async run(a, ctx) {
        const done: string[] = [];
        if (changes(a)) {
          if (!ctx.callAsOwner) return "not run: the owner did not approve it";
          const asOwner = ctx.callAsOwner;
          const ch = a.channel ? channelOf(a.channel) : undefined;
          if (a.hours !== undefined && ch) {
            // The whole channel goes back as it is: a field left out would take its default.
            const { id, hours: _, ...rest } = ch;
            await asOwner("channels.set", { id, channel: { ...rest, ...(a.hours ? { hours: a.hours } : {}) } });
            done.push(`${ch.label}: ${a.hours ? hoursText(a.hours) : "at any hour"}`);
          }
          for (const c of a.any_hour === undefined ? [] : (a.contacts ?? [])) {
            const p = contactOf(store, c);
            if (typeof p === "string") return p;
            await asOwner("contacts.set", { id: p.id, name: p.name, any_hour: a.any_hour });
            done.push(`${inlineName(p.name)}: ${a.any_hour ? "answered at any hour" : "waits for the hours"}`);
          }
        }
        const tz = ownerTimeZone(store) ?? "this computer's time zone";
        const channels = store.settings
          .read("channels")
          .filter((c) => c.enabled)
          .map((c) => `- ${c.label} [${c.id}]: ${c.hours ? hoursText(c.hours) : "at any hour"}`);
        const through = store.persons
          .list()
          .filter((p) => p.role === "contact" && p.any_hour)
          .map((p) => `${inlineName(p.name)} [${p.id}]`);
        return [
          done.length ? `Saved. ${done.join("; ")}.` : "",
          `Hours answer contacts on the owner's clocks (${tz}); outside them a contact waits, unanswered, until they begin.`,
          ...(channels.length ? channels : ["no channels set up."]),
          `Answered at any hour: ${through.join(", ") || "nobody"}.`,
        ]
          .filter(Boolean)
          .join("\n");
      },
    }),
  ];
}
