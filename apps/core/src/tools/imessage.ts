// iMessage on the owner's Mac as two tools, offered only when the owner turned it on (see engine/turn.ts): reading
// recent messages (other people's words come back as outside data) and sending one, which waits for the owner's OK.
import { z } from "zod";
import type { IMessageOps } from "../imessage.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export const IMESSAGE_TOOLS = new Set(["imessage_read", "imessage_send"]);

/** A phone number with its country code, or an Apple ID's email. */
const Address = z
  .string()
  .trim()
  .regex(/^(\+\d{6,15}|[^\s@]+@[^\s@]+\.[^\s@]+)$/, "a phone number with + and country code, or an email");

export function imessageTools(ops: IMessageOps | undefined): Tool[] {
  if (!ops) return [];
  return [
    defineTool({
      name: "imessage_read",
      description:
        "Read the latest iMessages on the owner's Mac, all chats or one person's (with: their phone number or email). Oldest first.",
      args: z.object({ with: Address.optional(), limit: z.number().int().min(1).max(50).default(20) }),
      effect: "none",
      deadlineMs: 10_000,
      title: (a) => (a.with ? `Read iMessages with ${a.with}` : "Read recent iMessages"),
      async run(a) {
        const list = await ops.recent({ with: a.with, limit: a.limit });
        if (!list.length) return a.with ? `no iMessages with ${a.with}` : "no iMessages";
        const lines = list.map(
          (m) => `${m.at.slice(0, 16).replace("T", " ")} ${m.from_me ? "me" : m.handle}: ${m.text}`,
        );
        return untrusted("imessages", a.with ? { with: a.with } : {}, lines.join("\n"));
      },
    }),
    defineTool({
      name: "imessage_send",
      description:
        "Send an iMessage from the owner's Mac (to: a phone number with + and country code, or an email). The owner confirms it first.",
      args: z.object({ to: Address, text: z.string().min(1).max(4000) }),
      effect: "external",
      // It speaks as the owner: it always waits for their OK.
      confirm: "always",
      deadlineMs: 30_000,
      title: (a) => `Sent an iMessage to ${a.to ?? "someone"}`,
      async run(a) {
        await ops.send(a.to, a.text);
        return `sent to ${a.to}`;
      },
    }),
  ];
}
