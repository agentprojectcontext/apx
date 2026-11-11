import { IconButton, Icons, NavItem } from "@apx/ui";
import { useMemo, useState } from "react";
import { useAccountCounts } from "../channels/counts.ts";
import { markAllRead } from "../data/actions.ts";
import { useChannels } from "../data/channels.ts";
import { setPrefs, usePrefs, useSidebarRows } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { unreadWhere } from "../inbox/groupThreads.ts";
import { soleFilter, useInboxFilter } from "../inbox/inboxFilter.ts";
import { ChannelNavRow } from "./ChannelNavRow.tsx";
import { go, useNav } from "./nav.ts";
import { SidebarOverflow, SidebarRowsGrip, SidebarSection } from "./SidebarSection.tsx";

/** The most recently active channels, as many as the owner dragged the section to; manual order lasts until newer activity arrives. */
export function ChannelsNav({ rail, compact = false }: { rail: boolean; compact?: boolean }) {
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
  const accountCounts = useAccountCounts();
  const counts = useMemo(() => new Map([...accountCounts].map(([id, c]) => [id, c.unread])), [accountCounts]);
  // Folding a single leftover would save nothing.
  const cut = ordered.length > rows + 1 ? rows : ordered.length;
  const shown = ordered.slice(0, cut);
  const rest = ordered.slice(cut);
  // An account opens the Inbox narrowed to it: one picked from under "more" marks that row.
  const filtered = useInboxFilter((f) => {
    const sole = soleFilter(f);
    return sole?.kind === "accounts" ? sole.id : undefined;
  });
  const hiddenActive = rest.some(
    (channel) => (view === "channel" && channel.id === channelId) || (view === "inbox" && channel.id === filtered),
  );
  const hiddenUnread = rest.reduce((sum, channel) => sum + (counts.get(channel.id) ?? 0), 0);
  const unreadIds = useMemo(() => unreadWhere(threads, (thread) => !!thread.channel), [threads]);
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
      waiting={accountCounts.get(channel.id)?.waiting ?? 0}
      onClose={() => setMoreOpen(false)}
      onMove={move}
    />
  );
  const add = (
    <IconButton
      size="sm"
      className="sidebar__add"
      label={t("chs.new")}
      icon={<Icons.Plus size={14} />}
      onClick={() => go.newChannel()}
    />
  );
  const moreLabel = t("nav.moreChannels", { n: rest.length });
  return (
    <SidebarSection
      rail={rail}
      title={t("nav.channels")}
      action={add}
      compact={compact}
      icon={<Icons.MessageCircle size={16} />}
      count={ordered.length}
      active={view === "channel" || view === "channels" || (view === "inbox" && filtered !== undefined)}
      folded={folded}
      unread={totalUnread}
      unreadLabel={t("nav.channelsUnread", { unread: totalUnread })}
      menu={[
        {
          label: t("inbox.markAllRead"),
          icon: <Icons.CheckCheck />,
          disabled: unreadIds.length === 0,
          onSelect: () => markAllRead(unreadIds),
        },
      ]}
      onToggle={() => {
        setMoreOpen(false);
        setPrefs({ channelsFolded: !folded });
      }}
    >
      {(compact || !hidden) && (
        <NavItem
          // In the flyout (compact) the row is a list item with its words, like the channels under it.
          collapsed={rail && !compact}
          className="channelsnav__manage"
          icon={<Icons.LayoutGrid />}
          label={t("nav.manageChannels")}
          active={view === "channels"}
          onClick={() => go.view("channels")}
        />
      )}
      {compact && <div className="channelsnav__shown">{ordered.map((channel) => row(channel, true))}</div>}
      {!compact && !hidden && <div className="channelsnav__shown">{shown.map((channel) => row(channel))}</div>}
      {!compact && !hidden && rest.length > 0 && (
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
      {!compact && !hidden && !rail && (
        <SidebarRowsGrip section="channels" total={ordered.length} title={t("nav.channels")} />
      )}
    </SidebarSection>
  );
}
