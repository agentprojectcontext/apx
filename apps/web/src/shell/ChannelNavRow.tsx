import type { ChannelInfo } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { accountItems } from "../channels/accountMenu.tsx";
import { accountName } from "../channels/accountName.ts";
import { KindTile } from "../channels/KindIcon.tsx";
import { isChannelKind } from "../channels/kinds.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { soleFilter, useInboxFilter } from "../inbox/inboxFilter.ts";
import { openAccount } from "../inbox/openAccount.ts";
import { useNav } from "./nav.ts";
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
  const threads = useData((s) => s.threads);
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const label = accountName(channel, t);
  const pick = () => {
    onClose();
    openAccount(channel.id);
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
        ...accountItems(channel, t, waiting, threads, onClose),
        { type: "separator" },
        ...orderItems(t, channel.id, order, onMove),
      ]}
    />
  );
}
