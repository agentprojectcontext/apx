// contact_list / channel_list: what the owner set up, read by their agent ("who is Alex?", "can you reach Discord?").
// Read only: changes from chat (a channel's hours, a contact let through them) go through apx_settings, each once the
// owner approves it. Routines are in routines.ts.
import type { ChannelHours } from "@apx/protocol";
import { z } from "zod";
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

/** Whether any channel is on (iMessage included): the channel and contact tools are offered only then. */
export const channelsOn = (store: Store) =>
  store.settings.read("channels").some((c) => c.enabled) || store.settings.read("imessage").on;

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

export function directoryTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "channel_list",
      description:
        "List the channels APX talks through for the owner (WhatsApp, Telegram, Discord, Slack…), whether each is up, and its rooms: shared places inside a channel, such as a Discord #channel, as opposed to contacts, who are people (contact_list). Check it before saying you cannot reach a channel or a room.",
      args: z.object({}),
      effect: "none",
      when: () => channelsOn(store),
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
      when: () => channelsOn(store),
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
  ];
}
