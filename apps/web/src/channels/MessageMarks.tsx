// What a message sent on a channel carries besides its words: how far it got (ticks) and the emoji put on it. Shared
// by the channel view and the main chat, so both read the same.
import type { MessageDelivery, MessageReaction } from "@apx/protocol";
import { Icons, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
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
