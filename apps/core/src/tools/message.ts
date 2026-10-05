// message_contact: the owner's agent writes to one of the owner's contacts on a channel ("tell Alex on WhatsApp…"),
// as v1's send_whatsapp did. Contacts' own turns never get it (see CONTACT_TOOLS in turn.ts): a contact cannot make
// the agent write to someone else.
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function messageTools(store: Store): Tool[] {
  /** The owner's contact a name (or id) points at; several or none: why, with the names that do exist. */
  const resolve = (to: string): { id: string; name: string } | { problem: string } => {
    const contacts = store.persons.list().filter((p) => p.role === "contact");
    const exact = contacts.find((p) => p.id === to);
    if (exact) return exact;
    const q = norm(to);
    const whole = contacts.filter((p) => norm(p.name) === q || (p.nickname && norm(p.nickname) === q));
    const part = whole.length
      ? whole
      : contacts.filter((p) =>
          norm(p.name)
            .split(/\s+/)
            .some((w) => w === q || w.startsWith(q)),
        );
    if (part.length === 1 && part[0]) return part[0];
    if (part.length > 1)
      return { problem: `"${to}" matches ${part.map((p) => `${p.name} (${p.id})`).join(", ")}: say which one` };
    return {
      problem: `no contact named "${to}". Contacts: ${
        contacts
          .slice(0, 30)
          .map((p) => p.name)
          .join(", ") || "none"
      }`,
    };
  };
  return [
    defineTool({
      name: "message_contact",
      description:
        "Write to one of your owner's contacts on a channel (WhatsApp, Telegram, Discord) when the owner asks you to: 'tell Alex…', 'answer her on WhatsApp'. `to` is the contact's name (or id); `channel` is optional (whatsapp, telegram, discord: by default the one they talked on last). Plain text, as a person types it: no markdown. It is sent at once and cannot be taken back. Write it in first person as your owner's assistant; never invent what the owner did not say. The result shows the end of that chat: read it before telling the owner it went.",
      args: z.object({
        to: z.string().trim().min(1).max(120),
        text: z.string().trim().min(1).max(4000),
        channel: z.string().max(60).optional(),
      }),
      effect: "message",
      // Words go to someone else: asked while outside content is in the turn, unless the agent's autonomy is total.
      confirm: "untrusted",
      deadlineMs: 15_000,
      title: (a) => `Wrote to ${String(a.to ?? "a contact")}`,
      async run(a, ctx) {
        const who = resolve(a.to);
        if ("problem" in who) return `not sent: ${who.problem}`;
        const r = await ctx.call("channels.message", {
          person: who.id,
          text: a.text,
          ...(a.channel ? { channel: a.channel } : {}),
        });
        const tail = r.recent.map((m) => `${m.from}: ${m.text}`).join("\n");
        return `sent to ${who.name} on ${r.channel} (queued for delivery).${tail ? `\nThe chat before it:\n${untrusted("contact_chat", { with: who.name }, tail)}` : ""}`;
      },
    }),
  ];
}
