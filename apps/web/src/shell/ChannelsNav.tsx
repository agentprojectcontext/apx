import { IconButton, Icons, Menu } from "@apx/ui";
import { useMemo, useState } from "react";
import { addChannelItems } from "../channels/KindIcon.tsx";
import { CHANNEL_KIND_IDS } from "../channels/kinds.ts";
import { useChannels } from "../data/channels.ts";
import { setPrefs, usePrefs, useSidebarRows } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ChannelNavRow } from "./ChannelNavRow.tsx";
import { go, useNav } from "./nav.ts";
import { SidebarOverflow, SidebarRowsGrip, SidebarSection } from "./SidebarSection.tsx";

/** The most recently active channels, as many as the owner dragged the section to; manual order lasts until newer activity arrives. */
export function ChannelsNav({ rail }: { rail: boolean }) {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const saved = usePrefs((s) => s.channelOrder);
  const orderAt = usePrefs((s) => s.channelOrderAt);
  const folded = usePrefs((s) => s.channelsFolded);
  const hidden = folded && !rail;
  const threads = useData((s) => s.threads);
  const view = useNav((s) => s.view);
  const channelId = useNav((s) => s.channelId);
  const [moreOpen, setMoreOpen] = useState(false);
  const rows = useSidebarRows("channels");
  const ordered = useMemo(() => {
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const ids = [...new Set([...saved, ...channels.map((channel) => channel.id)])];
    const lastActivity = new Map<string, string>();
    for (const thread of Object.values(threads))
      if (thread.channel && thread.updated_at > (lastActivity.get(thread.channel.id) ?? ""))
        lastActivity.set(thread.channel.id, thread.updated_at);
    const recent = (id: string) => {
      const at = lastActivity.get(id) ?? "";
      return at > orderAt ? at : "";
    };
    ids.sort((a, b) => recent(b).localeCompare(recent(a)));
    return ids.flatMap((id) => {
      const channel = byId.get(id);
      return channel ? [channel] : [];
    });
  }, [channels, saved, threads, orderAt]);
  const counts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of Object.values(threads)) {
      if (thread.channel) counts.set(thread.channel.id, (counts.get(thread.channel.id) ?? 0) + thread.unread);
    }
    return counts;
  }, [threads]);
  // Folding a single leftover would save nothing.
  const cut = ordered.length > rows + 1 ? rows : ordered.length;
  const shown = ordered.slice(0, cut);
  const rest = ordered.slice(cut);
  const hiddenActive = view === "channel" && rest.some((channel) => channel.id === channelId);
  const hiddenUnread = rest.reduce((sum, channel) => sum + (counts.get(channel.id) ?? 0), 0);
  const totalUnread = ordered.reduce((sum, channel) => sum + (counts.get(channel.id) ?? 0), 0);

  const move = (id: string, index: number) => {
    const ids = ordered.map((channel) => channel.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    const channelOrderAt = Object.values(threads).reduce(
      (latest, thread) =>
        thread.channel && ids.includes(thread.channel.id) && thread.updated_at > latest ? thread.updated_at : latest,
      "",
    );
    setPrefs({ channelOrder: ids, channelOrderAt });
  };
  const order = ordered.map((channel) => channel.id);
  const row = (channel: (typeof ordered)[number], overflow = false) => (
    <ChannelNavRow
      key={channel.id}
      channel={channel}
      rail={rail && !overflow}
      order={order}
      count={counts.get(channel.id) ?? 0}
      onClose={() => setMoreOpen(false)}
      onMove={move}
    />
  );
  const missing = addChannelItems(
    channels.map((channel) => channel.type),
    t,
    go.channelConfig,
  );
  const add = CHANNEL_KIND_IDS.some((kind) => !channels.some((channel) => channel.type === kind)) ? (
    <Menu
      align="start"
      trigger={
        <IconButton size="sm" className="sidebar__add" label={t("channels.add")} icon={<Icons.Plus size={14} />} />
      }
      items={missing}
    />
  ) : null;
  const moreLabel = t("nav.moreChannels", { n: rest.length });
  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("nav.channels")}
        action={add}
        folded={folded}
        unread={totalUnread}
        unreadLabel={t("nav.channelsUnread", { unread: totalUnread })}
        onToggle={() => {
          setMoreOpen(false);
          setPrefs({ channelsFolded: !folded });
        }}
      />
      {!hidden && <div className="channelsnav__shown">{shown.map((channel) => row(channel))}</div>}
      {!hidden && rest.length > 0 && (
        <SidebarOverflow
          rail={rail}
          title={t("nav.channels")}
          text={moreLabel}
          label={hiddenUnread ? t("nav.moreChannelsUnread", { n: rest.length, unread: hiddenUnread }) : moreLabel}
          count={rest.length}
          unread={hiddenUnread}
          active={hiddenActive}
          open={moreOpen}
          onOpenChange={setMoreOpen}
        >
          {rest.map((channel) => row(channel, true))}
        </SidebarOverflow>
      )}
      {!hidden && !rail && <SidebarRowsGrip section="channels" total={ordered.length} title={t("nav.channels")} />}
    </>
  );
}
