import type { ChannelInfo } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { accountItems } from "../channels/accountMenu.tsx";
import { KindTile } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { useT } from "../i18n/index.ts";
import { onlyFilter, soleFilter, useInboxFilter } from "../inbox/inboxFilter.ts";
import { go, useNav } from "./nav.ts";
import { orderItems, SidebarNavRow } from "./SidebarNavRow.tsx";

export function ChannelNavRow({
  channel,
  order,
  rail,
  count,
  waiting,
  onClose,
  onMove,
}: {
  channel: ChannelInfo;
  order: string[];
  rail: boolean;
  count: number;
  /** Who waits to be let in on it. */
  waiting: number;
  onClose(): void;
  onMove(id: string, index: number): void;
}) {
  const t = useT();
  const view = useNav((s) => s.view);
  const channelId = useNav((s) => s.channelId);
  // Picked, the account narrows the Inbox to its chats (its own screen stays in the row's menu).
  const filtering = useInboxFilter((f) => {
    const sole = soleFilter(f);
    return sole?.kind === "accounts" && sole.id === channel.id;
  });
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const label = channel.label || (kind ? t(CHANNEL_KINDS[kind].name) : channel.id);
  const pick = () => {
    onClose();
    onlyFilter("accounts", channel.id);
    go.inbox();
  };
  return (
    <SidebarNavRow
      id={channel.id}
      kind="channel"
      rail={rail}
      icon={kind ? <KindTile kind={kind} /> : <Icons.Send />}
      label={label}
      count={count}
      active={(view === "channel" && channelId === channel.id) || (view === "inbox" && filtering)}
      onPick={pick}
      order={order}
      onMove={onMove}
      items={[
        ...accountItems(channel, t, waiting, onClose),
        { type: "separator" },
        ...orderItems(t, channel.id, order, onMove),
      ]}
    />
  );
}
