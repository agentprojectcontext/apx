import { ChannelIcon, type MenuEntry, ProjectTile } from "@apx/ui";
import type { T } from "../i18n/index.ts";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, type ChannelKind } from "./kinds.ts";

/** A channel kind's tile: its official mark on a neutral tile. */
export function KindTile({ kind, size = 20 }: { kind: ChannelKind; size?: number }) {
  return (
    <ProjectTile tone="neutral" icon={<ChannelIcon channel={kind} size={Math.round(size * 0.68)} />} size={size} />
  );
}

/** A channel kind's bare mark, for menus and tags. */
export function KindIcon({ kind, size = 14 }: { kind: ChannelKind; size?: number }) {
  return <ChannelIcon channel={kind} size={size} />;
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
