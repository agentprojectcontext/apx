import { useMemo } from "react";
import { Text, View } from "react-native";
import { channelName } from "../hooks/chatSelectors";
import type { Agent, Channel, Thread } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { ALL_CHATS, type ChatFilter, filtering } from "../viewPrefs";
import { ChannelMark } from "./ChannelMark";
import { Icon } from "./Icon";
import { AgentAvatar, BottomSheet, ListRow, Toggle } from "./kit";
import { makeStyles, useTheme } from "./theme";

/**
 * What Chats shows: each channel account on or off and whether their chats go together, routine news and task chats on
 * or off, and only the agents ticked. Each change applies at once.
 */
export function ChatFilterSheet({
  filter,
  agents,
  channels,
  threads,
  onChange,
  onClose,
}: {
  filter: ChatFilter;
  agents: Agent[];
  channels: Channel[];
  /** Every chat, to count each account's. */
  threads: Thread[];
  onChange: (next: ChatFilter) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const ticked = new Set(filter.agents);
  const tick = (id: string) =>
    onChange({
      ...filter,
      agents: ticked.has(id) ? filter.agents.filter((item) => item !== id) : [...filter.agents, id],
    });
  const accounts = useMemo(() => {
    const n = new Map<string, number>();
    for (const thread of threads)
      if (thread.channel && !thread.archived) n.set(thread.channel.id, (n.get(thread.channel.id) ?? 0) + 1);
    return channels
      .map((channel) => ({ channel, count: n.get(channel.id) ?? 0 }))
      .filter(({ channel, count }) => count > 0 || filter.hiddenChannels.includes(channel.id))
      .sort((a, b) => b.count - a.count);
  }, [channels, threads, filter.hiddenChannels]);
  const show = (id: string, on: boolean) =>
    onChange({
      ...filter,
      hiddenChannels: on ? filter.hiddenChannels.filter((item) => item !== id) : [...filter.hiddenChannels, id],
    });
  const check = (on: boolean) =>
    on ? <Icon name="Check" size={18} color={theme.brand} /> : <View style={{ width: 18 }} />;
  return (
    <BottomSheet title={t("filterChats")} onClose={onClose}>
      {accounts.length > 0 ? (
        <>
          <Text style={s.section}>{t("filterChannels")}</Text>
          {accounts.map(({ channel, count }) => {
            const name = channel.label || channelName(channel.type);
            const on = !filter.hiddenChannels.includes(channel.id);
            return (
              <ListRow
                key={channel.id}
                label={name}
                detail={String(count)}
                leading={<ChannelMark type={channel.type} size={20} />}
                chevron={false}
                onPress={() => show(channel.id, !on)}
                trailing={<Toggle label={name} value={on} onChange={(next) => show(channel.id, next)} />}
              />
            );
          })}
          <ListRow
            label={t("filterByChannel")}
            leading={<Icon name="Inbox" size={18} color={theme.fgMuted} />}
            chevron={false}
            onPress={() => onChange({ ...filter, byChannel: !filter.byChannel })}
            trailing={
              <Toggle
                label={t("filterByChannel")}
                value={filter.byChannel}
                onChange={(byChannel) => onChange({ ...filter, byChannel })}
              />
            }
          />
        </>
      ) : null}
      <Text style={s.section}>{t("filterShow")}</Text>
      <ListRow
        label={t("filterRoutines")}
        leading={<Icon name="Clock" size={18} color={theme.fgMuted} />}
        chevron={false}
        onPress={() => onChange({ ...filter, routines: !filter.routines })}
        trailing={
          <Toggle
            label={t("filterRoutines")}
            value={filter.routines}
            onChange={(routines) => onChange({ ...filter, routines })}
          />
        }
      />
      <ListRow
        label={t("filterTasks")}
        leading={<Icon name="ListChecks" size={18} color={theme.fgMuted} />}
        chevron={false}
        onPress={() => onChange({ ...filter, tasks: !filter.tasks })}
        trailing={
          <Toggle label={t("filterTasks")} value={filter.tasks} onChange={(tasks) => onChange({ ...filter, tasks })} />
        }
      />
      <Text style={s.section}>{t("filterAgents")}</Text>
      <ListRow
        label={t("filterAllAgents")}
        leading={<Icon name="Users" size={18} color={theme.fgMuted} />}
        chevron={false}
        trailing={check(ticked.size === 0)}
        onPress={() => onChange({ ...filter, agents: [] })}
      />
      {agents.map((agent) => (
        <ListRow
          key={agent.id}
          label={agent.name}
          leading={<AgentAvatar name={agent.name} blob={agent.blob} id={agent.id} size={24} />}
          chevron={false}
          trailing={check(ticked.has(agent.id))}
          onPress={() => tick(agent.id)}
        />
      ))}
      {filtering(filter) ? (
        <ListRow
          label={t("filterClear")}
          leading={<Icon name="RotateCcw" size={18} color={theme.fgMuted} />}
          chevron={false}
          // Clearing shows everything again; how chats are grouped is a way of looking, kept.
          onPress={() => onChange({ ...ALL_CHATS, byChannel: filter.byChannel })}
        />
      ) : null}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme) => ({
  section: {
    color: theme.fgSubtle,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
}));
