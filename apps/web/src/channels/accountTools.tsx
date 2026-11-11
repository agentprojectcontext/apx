import type { ChannelInfo } from "@apx/protocol";
import { Icons } from "@apx/ui";
import type { ReactNode } from "react";
import type { T } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { isChannelKind, isRoomsKind, roomsOpenKey } from "./kinds.ts";

/** One of an account's own tools: its rooms, its contacts, its settings. */
export type AccountTool = { key: string; label: string; icon: ReactNode; onSelect(): void };

/** An account's tools, as its header shows them beside its name (and its menu, where the header has no room). */
export function accountTools(channel: ChannelInfo, t: T, settingsLabel = t("ch.settings")): AccountTool[] {
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  if (!kind) return [];
  return [
    ...(isRoomsKind(kind)
      ? [
          {
            key: "rooms",
            label: t(roomsOpenKey(kind)),
            icon: <Icons.Hash size={14} />,
            onSelect: () => go.channelSettings(kind, channel.id, "rooms"),
          },
        ]
      : []),
    {
      key: "contacts",
      label: t("chs.contacts"),
      icon: <Icons.Users size={14} />,
      onSelect: () => go.channelSettings(kind, channel.id, "contacts"),
    },
    {
      key: "settings",
      label: settingsLabel,
      icon: <Icons.Settings size={14} />,
      onSelect: () => go.channelSettings(kind, channel.id, "account"),
    },
  ];
}
