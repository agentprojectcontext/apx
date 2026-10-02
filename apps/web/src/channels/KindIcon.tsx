import { Icons, ProjectTile } from "@apx/ui";
import { CHANNEL_KINDS, type ChannelKind } from "./kinds.ts";

const ICONS = { telegram: Icons.Send, whatsapp: Icons.MessageCircle, discord: Icons.Users } as const;

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
