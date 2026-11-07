// The chat app a message went out or came in on, as the panel's channels/MessageMarks.tsx reads it.
import { CHROME_VIA } from "../../../../packages/protocol/src/constants.ts";
import type { Message } from "../protocol";

export type Via = { kind: string; label: string | undefined; out: boolean };

/**
 * Where a message went out or came in, when the chat is not that app's own (Home, a project's chat): there the owner
 * could not tell it also reached their phone or a contact's. None for a chat of that very channel.
 */
export function viaOf(
  message: Pick<Message, "via" | "author">,
  chatChannel: string | undefined,
  channels: ReadonlyArray<{ id: string; type: string; label: string }>,
): Via | undefined {
  if (!message.via || message.via === chatChannel) return undefined;
  const out = message.author.kind === "agent" || (message.author.kind === "user" && Boolean(message.author.direct));
  // APX's panel in Chrome is not a channel: its mark says where the words were written and answered.
  if (message.via === CHROME_VIA) return { kind: "chrome", label: "Chrome", out };
  const channel = channels.find((one) => one.id === message.via);
  return { kind: channel?.type ?? "", label: channel?.label, out };
}
