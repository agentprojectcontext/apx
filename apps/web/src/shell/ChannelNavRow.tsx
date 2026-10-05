import type { ChannelInfo } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { KindTile } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";
import { SidebarNavRow } from "./SidebarNavRow.tsx";

export function ChannelNavRow({
  channel,
  order,
  rail,
  count,
  onClose,
  onMove,
}: {
  channel: ChannelInfo;
  order: string[];
  rail: boolean;
  count: number;
  onClose(): void;
  onMove(id: string, index: number): void;
}) {
  const t = useT();
  const view = useNav((s) => s.view);
  const channelId = useNav((s) => s.channelId);
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const label = channel.label || (kind ? t(CHANNEL_KINDS[kind].name) : channel.id);
  const index = order.indexOf(channel.id);
  const pick = () => {
    onClose();
    go.channel(channel.id);
  };
  return (
    <SidebarNavRow
      id={channel.id}
      kind="channel"
      rail={rail}
      icon={kind ? <KindTile kind={kind} /> : <Icons.Send />}
      label={label}
      count={count}
      active={view === "channel" && channelId === channel.id}
      onPick={pick}
      order={order}
      onMove={onMove}
      items={[
        { label: t("nav.open"), icon: <Icons.MessageCircle />, onSelect: pick },
        ...(kind
          ? [
              {
                label: t("ch.settings"),
                icon: <Icons.Settings />,
                onSelect: () => {
                  onClose();
                  go.channelConfig(kind);
                },
              },
            ]
          : []),
        { type: "separator" },
        {
          label: t("nav.channelFirst"),
          icon: <Icons.ChevronUp />,
          disabled: index === 0,
          onSelect: () => onMove(channel.id, 0),
        },
        {
          label: t("nav.channelUp"),
          icon: <Icons.ChevronUp />,
          disabled: index === 0,
          onSelect: () => onMove(channel.id, index - 1),
        },
        {
          label: t("nav.channelDown"),
          icon: <Icons.ChevronDown />,
          disabled: index === order.length - 1,
          onSelect: () => onMove(channel.id, index + 1),
        },
      ]}
    />
  );
}
