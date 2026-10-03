// The owner's word on someone who wrote on a channel and waits: "yes, answer them" or "ignore them", said to the
// agent instead of tapped in the app. Contacts' chats never get these tools (see CONTACT_TOOLS in turn.ts).
import { z } from "zod";
import { pairingRef } from "../channels/inbound.ts";
import type { Store } from "../domain/store.ts";
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

/**
 * For the owner's turn with a channel's agent: who waits for their word right now, by request code, channel and number only (nothing the
 * stranger wrote, so the turn stays the owner's own words). Empty when nobody waits.
 */
export function waitingBlock(store: Store, agentId: string): string {
  const asked = new Set(
    store.settings
      .read("channels")
      .filter((c) => c.strangers === "ask" && c.agent_id === agentId)
      .map((c) => c.id),
  );
  const open = store.channels.pairing.open().filter((r) => asked.has(r.channel));
  if (!open.length) return "";
  const lines = open
    .slice(0, 10)
    .map((r) => `- request ${r.code}: someone on ${whereFrom(store, r)}, ${ago(r.created_at)}`);
  return `Waiting for the owner's OK to be answered (contact_requests shows what they wrote; answer_contact_request decides):\n${lines.join("\n")}`;
}

export function requestTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "contact_requests",
      description:
        'People who wrote to the owner on a channel (WhatsApp, Telegram) and wait for the owner\'s OK before anyone answers them: their request code, where they wrote from, the name they gave and their first message. Use it when the owner speaks about someone who wrote ("answer her", "who wrote?", "ignore that one").',
      args: z.object({}),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at who is waiting",
      async run() {
        const open = store.channels.pairing.open();
        if (!open.length) return "Nobody is waiting.";
        // Names and first messages are the strangers' own words: data, never instructions.
        return open
          .slice(0, 20)
          .map(
            (r) =>
              `request ${r.code} · ${whereFrom(store, r)} · ${ago(r.created_at)}\n${untrusted("contact_request", { code: r.code }, `name: ${r.name}${r.text ? `\nfirst message: ${r.text.slice(0, 300)}` : ""}`)}`,
          )
          .join("\n\n");
      },
    }),
    defineTool({
      name: "answer_contact_request",
      description:
        "Carry out the owner's decision on someone waiting (see contact_requests): answer = they become a contact and their first message is answered now (a sealed chat: no tools, no memory); ignore = nobody answers them. Only when the owner said so in their own words.",
      args: z.object({
        code: z.string().regex(/^\d{4,12}$/),
        decision: z.enum(["answer", "ignore"]),
        name: z.string().trim().min(1).max(80).optional().describe("how to call them, when the owner said it"),
      }),
      effect: "external",
      // Letting someone in is the owner's act: it runs once they approve this call. Ignoring changes nothing outside.
      confirm: (a) => (a.decision === "answer" ? "always" : "never"),
      deadlineMs: 30_000,
      title: (a) => (a.decision === "answer" ? `Let ${String(a.code)} in` : `Ignored ${String(a.code)}`),
      async run(a, ctx) {
        const req = store.channels.pairing.get(a.code);
        if (!req) return `no open request ${a.code}: it was answered, ignored or expired`;
        if (a.decision === "ignore") {
          store.channels.pairing.close(a.code, "denied");
          store.notifications.resolve("channel", pairingRef(a.code));
          return `ignored: nobody answers ${whereFrom(store, req)}`;
        }
        if (!ctx.callAsOwner) return "not run: the owner did not approve it";
        const r = await ctx.callAsOwner("pairing.respond", {
          code: a.code,
          decision: "contact",
          ...(a.name ? { name: a.name } : {}),
        });
        return `${r.person?.name ?? "they"} (${whereFrom(store, req)}) is a contact now: they get answers in their own chat.`;
      },
    }),
  ];
}
