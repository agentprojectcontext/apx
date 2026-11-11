// What a right click on a channel account offers, the same in the Channels screen and in the sidebar.
import type { ChannelInfo, Thread } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import { markAllRead } from "../data/actions.ts";
import { draftOf, saveChannel } from "../data/channels.ts";
import type { T } from "../i18n/index.ts";
import { unreadWhere } from "../inbox/groupThreads.ts";
import { go } from "../shell/nav.ts";
import { askRemove } from "./account/removeAsk.ts";
import { accountName, accountWhere, appName } from "./accountName.ts";
import { KindIcon } from "./KindIcon.tsx";
import { isChannelKind } from "./kinds.ts";

export function accountItems(
  channel: ChannelInfo,
  t: T,
  waiting: number,
  threads: Record<string, Thread>,
  before?: () => void,
): MenuEntry[] {
  const unread = unreadWhere(threads, (thread) => thread.channel?.id === channel.id);
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const run = (f: () => void) => () => {
    before?.();
    f();
  };
  return [
    {
      type: "label",
      label: (
        <span className="chs__menuhead">
          {kind ? <KindIcon kind={kind} size={14} /> : <Icons.Send size={14} />}
          {accountName(channel, t)}
        </span>
      ),
    },
    { label: t("nav.open"), icon: <Icons.MessageCircle />, onSelect: run(() => go.channel(channel.id)) },
    ...(kind
      ? [
          {
            label: t("chs.menu.edit"),
            icon: <Icons.Pencil />,
            onSelect: run(() => go.channelSettings(kind, channel.id)),
          },
          {
            label: t("chs.menu.contacts"),
            icon: <Icons.Users />,
            onSelect: run(() => go.channelSettings(kind, channel.id, "contacts")),
          },
          ...(waiting
            ? [
                {
                  label: t("chs.waiting", { n: waiting }),
                  icon: <Icons.Check />,
                  onSelect: run(() => go.channelSettings(kind, channel.id, "approvals")),
                },
              ]
            : []),
        ]
      : []),
    {
      label: t(channel.quiet ? "chs.menu.unquiet" : "chs.menu.quiet"),
      icon: channel.quiet ? <Icons.Bell /> : <Icons.BellOff />,
      onSelect: run(() => void saveChannel(channel.id, { ...draftOf(channel), quiet: !channel.quiet })),
    },
    {
      label: t(channel.enabled ? "chs.turnOff" : "chs.turnOn"),
      icon: <Icons.Power />,
      onSelect: run(() => void saveChannel(channel.id, { ...draftOf(channel), enabled: !channel.enabled })),
    },
    {
      label: t("inbox.markAllRead"),
      icon: <Icons.CheckCheck />,
      disabled: unread.length === 0,
      onSelect: run(() => markAllRead(unread)),
    },
    ...(kind
      ? [
          { type: "separator" as const },
          {
            label: t("chs.menu.disconnect"),
            icon: <Icons.X />,
            danger: true,
            onSelect: run(() => {
              askRemove(channel.id);
              go.channelSettings(kind, channel.id);
            }),
          },
        ]
      : []),
  ];
}

/** The account's line under its name: the number or bot it runs as and its rooms (its icon says the app). */
export function accountLine(channel: ChannelInfo, t: T): string {
  const rooms = channel.rooms?.rooms.length ?? 0;
  const line = [
    accountWhere(channel, accountName(channel, t)),
    rooms ? (rooms === 1 ? t("chs.rooms.one") : t("chs.rooms.other", { n: rooms })) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return line || appName(channel, t);
}
