// What a right click on a channel account offers, the same in the Channels screen and in the sidebar.
import type { ChannelInfo } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import { draftOf, saveChannel } from "../data/channels.ts";
import type { T } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { askRemove } from "./account/removeAsk.ts";
import { KindIcon } from "./KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "./kinds.ts";

export function accountItems(channel: ChannelInfo, t: T, waiting: number, before?: () => void): MenuEntry[] {
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const run = (f: () => void) => () => {
    before?.();
    f();
  };
  const app = kind ? t(CHANNEL_KINDS[kind].name) : channel.type;
  return [
    {
      type: "label",
      label: (
        <span className="chs__menuhead">
          {kind ? <KindIcon kind={kind} size={14} /> : <Icons.Send size={14} />}
          {t("ch.card.via", { app, account: channel.label })}
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

/** The account's line under its name: the app, the number or bot it runs as, and its rooms. */
export function accountLine(channel: ChannelInfo, t: T): string {
  const kind = isChannelKind(channel.type) ? t(CHANNEL_KINDS[channel.type].name) : channel.type;
  const rooms = channel.rooms?.rooms.length ?? 0;
  return [
    kind,
    channel.account ?? channel.email?.address,
    rooms ? (rooms === 1 ? t("chs.rooms.one") : t("chs.rooms.other", { n: rooms })) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
