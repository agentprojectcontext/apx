import { Icons, type MenuEntry, ProjectTile } from "@apx/ui";
import type { T } from "../i18n/index.ts";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, type ChannelKind } from "./kinds.ts";

const ICONS = {
  telegram: Icons.Send,
  whatsapp: Icons.MessageCircle,
  discord: Icons.Users,
  slack: Icons.Hash,
  signal: Icons.Shield,
  imessage: Icons.MessagesSquare,
  matrix: Icons.Grid2x2,
  teams: Icons.Building2,
  googlechat: Icons.MessagesSquare,
  mattermost: Icons.Hash,
  email: Icons.Mail,
  sms: Icons.Smartphone,
  line: Icons.AtSign,
} as const;

/** A channel kind's tile (Telegram blue, WhatsApp green, Discord violet). */
export function KindTile({ kind, size }: { kind: ChannelKind; size?: number }) {
  const Icon = ICONS[kind];
  return <ProjectTile tone={CHANNEL_KINDS[kind].tone} icon={<Icon />} {...(size ? { size } : {})} />;
}

/** A channel kind's bare icon, for menus. */
export function KindIcon({ kind, size = 14 }: { kind: ChannelKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} />;
}

/** "Add channel": the kinds not connected yet, those that work first and the coming ones under "Coming soon". */
export function addChannelItems(connected: readonly string[], t: T, pick: (k: ChannelKind) => void): MenuEntry[] {
  const missing = CHANNEL_KIND_IDS.filter((k) => !connected.includes(k));
  const entry = (k: ChannelKind): MenuEntry => ({
    label: t(CHANNEL_KINDS[k].name),
    icon: <KindIcon kind={k} />,
    disabled: CHANNEL_KINDS[k].soon,
    onSelect: () => pick(k),
  });
  const ready = missing.filter((k) => !CHANNEL_KINDS[k].soon);
  const soon = missing.filter((k) => CHANNEL_KINDS[k].soon);
  return [
    ...(ready.length ? [{ type: "label" as const, label: t("channels.ready") }, ...ready.map(entry)] : []),
    ...(soon.length ? [{ type: "label" as const, label: t("common.comingSoonShort") }, ...soon.map(entry)] : []),
  ];
}
