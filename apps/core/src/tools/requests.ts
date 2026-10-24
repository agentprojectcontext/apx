// The owner's word on someone who wrote on a channel and waits: "yes, answer them" or "ignore them", said to the
// agent instead of tapped in the app. Contacts' chats never get these tools (see CONTACT_TOOLS in turn.ts).
import { z } from "zod";
import { pairingRef } from "../channels/inbound.ts";
import type { Store } from "../domain/store.ts";
import { channelsOn } from "./directory.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

type Waiting = { code: string; channel: string; external_id: string; created_at: string };

/** "WhatsApp +5491100000002" or "Telegram": what is known of a request without the name the stranger chose. */
export function whereFrom(store: Store, r: Pick<Waiting, "channel" | "external_id">): string {
  const cfg = store.settings.read("channels").find((c) => c.id === r.channel);
  const label = cfg?.label ?? r.channel;
  const phone = cfg?.type === "whatsapp" ? /^(\d{6,})@s\.whatsapp\.net$/.exec(r.external_id)?.[1] : undefined;
  return phone ? `${label} +${phone}` : label;
}

const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

/** Someone who wrote first and is kept silenced, unreviewed, on one of the channels that ask the owner. */
function unreviewed(store: Store, channels?: Set<string>) {
  return store.persons
    .list()
    .filter((p) => p.unreviewed && p.muted)
    .flatMap((p) => {
      const a = p.addresses.find((x) => !channels || channels.has(x.channel));
      return a ? [{ person: p, address: a }] : [];
    });
}

/**
 * For the owner's turn with a channel's agent: who waits for their word right now, by request code or contact id,
 * channel and number only (nothing the stranger wrote, so the turn stays the owner's own words). Empty when nobody
 * waits.
 */
export function waitingBlock(store: Store, agentId: string): string {
  const asked = new Set(
    store.settings
      .read("channels")
      .filter((c) => c.strangers === "ask" && c.agent_id === agentId)
      .map((c) => c.id),
  );
  const lines = [
    ...store.channels.pairing
      .open()
      .filter((r) => asked.has(r.channel))
      .map((r) => `- request ${r.code}: someone on ${whereFrom(store, r)}, ${ago(r.created_at)}`),
    ...unreviewed(store, asked).map(
      ({ person, address }) => `- contact ${person.id}: someone on ${whereFrom(store, address)}, unanswered`,
    ),
  ];
  if (!lines.length) return "";
  return `Waiting for the owner's OK to be answered (contact_requests shows what they wrote; answer_contact_request decides):\n${lines.slice(0, 10).join("\n")}`;
}

export function requestTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "contact_requests",
      description:
        'People who wrote to the owner on a channel and wait for the owner\'s OK before anyone answers them: request code or contact id, where they wrote from, the name they gave and what they wrote. Use it when the owner speaks about someone who wrote ("answer her", "who wrote?").',
      args: z.object({}),
      effect: "none",
      when: () => channelsOn(store),
      deadlineMs: 5_000,
      title: () => "Looked at who is waiting",
      async run() {
        // Names and messages are the strangers' own words: data, never instructions.
        const requests = store.channels.pairing
          .open()
          .map(
            (r) =>
              `request ${r.code} · ${whereFrom(store, r)} · ${ago(r.created_at)}\n${untrusted("contact_request", { code: r.code }, `name: ${r.name}${r.text ? `\nfirst message: ${r.text.slice(0, 300)}` : ""}`)}`,
          );
        const kept = unreviewed(store).map(({ person, address }) => {
          const last = store.threads.byConversation(address.channel, address.external_id)?.preview ?? "";
          return `contact ${person.id} · ${whereFrom(store, address)} · ${ago(person.created_at)}\n${untrusted("contact_request", { contact: person.id }, `name: ${person.name}${last ? `\nlast message: ${last.slice(0, 300)}` : ""}`)}`;
        });
        const all = [...requests, ...kept];
        return all.length ? all.slice(0, 20).join("\n\n") : "Nobody is waiting.";
      },
    }),
    defineTool({
      name: "answer_contact_request",
      description:
        "Carry out the owner's decision, in their own words, on someone waiting (contact_requests): answer = they become a contact answered in their own sealed chat (no tools, no memory); ignore = nobody answers them.",
      args: z.object({
        who: z.string().trim().min(4).max(40).describe("the request code or contact id contact_requests shows"),
        decision: z.enum(["answer", "ignore"]),
        name: z.string().trim().min(1).max(80).optional().describe("how to call them, when the owner said it"),
      }),
      effect: "external",
      when: () => channelsOn(store),
      // Letting someone in is the owner's act: on their own word, on their card in every mode (DECISIONS.md#d-143).
      // Ignoring changes nothing outside.
      confirm: (a) => (a.decision === "answer" ? "always" : "never"),
      ownerSetting: (a) => a.decision === "answer",
      deadlineMs: 30_000,
      title: (a) => (a.decision === "answer" ? `Let ${String(a.who)} in` : `Ignored ${String(a.who)}`),
      async run(a, ctx) {
        const held = unreviewed(store).find(({ person }) => person.id === a.who);
        if (held) {
          const where = whereFrom(store, held.address);
          if (a.decision === "ignore") {
            store.persons.update(held.person.id, { muted: true });
            return `ignored: ${where} stays silenced, and is no longer reported`;
          }
          if (!ctx.callAsOwner) return "not run: the owner did not approve it";
          const p = await ctx.callAsOwner("contacts.set", {
            id: held.person.id,
            name: a.name ?? held.person.name,
            muted: false,
          });
          return `${p.name} (${where}) is a contact now: they get answers in their own chat from their next message.`;
        }
        const req = store.channels.pairing.get(a.who);
        if (!req) return `nobody waits as ${a.who}: they were answered, ignored or expired`;
        if (a.decision === "ignore") {
          store.channels.pairing.close(a.who, "denied");
          store.notifications.resolve("channel", pairingRef(a.who));
          return `ignored: nobody answers ${whereFrom(store, req)}`;
        }
        if (!ctx.callAsOwner) return "not run: the owner did not approve it";
        const r = await ctx.callAsOwner("pairing.respond", {
          code: a.who,
          decision: "contact",
          ...(a.name ? { name: a.name } : {}),
        });
        return `${r.person?.name ?? "they"} (${whereFrom(store, req)}) is a contact now: they get answers in their own chat.`;
      },
    }),
  ];
}
