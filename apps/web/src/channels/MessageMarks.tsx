// What a message sent on a channel carries besides its words: the chat app it went out or came in on, how far it got
// (ticks) and the emoji put on it. Shared by the channel view and the main chat, so both read the same.
import type { Message, MessageDelivery, MessageReaction, Thread } from "@apx/protocol";
import { ChannelIcon, Icons, Tooltip } from "@apx/ui";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { loadChannels, useChannels } from "../data/channels.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

const TICKS: Record<MessageDelivery, { icon: ReactNode; label: MessageKey }> = {
  pending: { icon: <Icons.Clock size={12} />, label: "ch.delivery.pending" },
  sent: { icon: <Icons.Check size={12} />, label: "ch.delivery.sent" },
  delivered: { icon: <Icons.CheckCheck size={12} />, label: "ch.delivery.delivered" },
  read: { icon: <Icons.CheckCheck size={12} />, label: "ch.delivery.read" },
  failed: { icon: <Icons.TriangleAlert size={12} />, label: "ch.delivery.failed" },
};

/** How far a message sent to them got: queued, sent, on their phone, read (where the channel tells), or not sent. */
export function DeliveryTicks({ state }: { state: MessageDelivery }) {
  const t = useT();
  const tick = TICKS[state];
  return (
    <Tooltip content={t(tick.label)}>
      <span className={`chan__ticks is-${state}`} role="img" aria-label={t(tick.label)}>
        {tick.icon}
      </span>
    </Tooltip>
  );
}

/** The emoji on a message, the agent's and theirs, each saying whose it is. */
export function ReactionList({ list, agentName }: { list: MessageReaction[]; agentName: string }) {
  const t = useT();
  return list.map((r) => {
    const label = r.by === "agent" ? t("ch.reaction.agent", { agent: agentName }) : t("ch.reaction.them");
    return (
      <Tooltip key={r.by} content={label}>
        <span role="img" aria-label={`${label}: ${r.emoji}`}>
          {r.emoji}
        </span>
      </Tooltip>
    );
  });
}

/** The channel a transcript shows only the part of (Home filtered to it): its messages need no mark. */
export const ViaFilter = createContext<string | undefined>(undefined);

/**
 * The chat app a message went out or came in on, when the chat is not that app's own (Home, a project's chat): there
 * the owner could not tell it also reached their phone or a contact's. None for a chat of that very channel.
 */
export function useVia(thread: Thread, message: Message) {
  const channel = useChannels((s) => s.channels.find((c) => c.id === message.via));
  const ready = useChannels((s) => s.ready);
  const filtered = useContext(ViaFilter);
  const shown = Boolean(message.via) && message.via !== thread.channel?.id && message.via !== filtered;
  useEffect(() => {
    if (shown && !ready) void loadChannels();
  }, [shown, ready]);
  if (!shown) return undefined;
  const out = message.author.kind === "agent" || (message.author.kind === "user" && Boolean(message.author.direct));
  return { kind: channel?.type ?? "", label: channel?.label, out };
}

/** A small mark of that app, saying whether the message went out there or came in from there. */
export function ViaMark({ thread, message }: { thread: Thread; message: Message }) {
  const t = useT();
  const via = useVia(thread, message);
  if (!via) return null;
  const app = via.label ?? t("ch.via.otherApp");
  const label = t(via.out ? "ch.via.sent" : "ch.via.received", { channel: app });
  return (
    <Tooltip content={label}>
      <span className="chan__via" role="img" aria-label={label} data-via={via.kind || "other"}>
        <ChannelIcon channel={via.kind} size={12} />
      </span>
    </Tooltip>
  );
}
