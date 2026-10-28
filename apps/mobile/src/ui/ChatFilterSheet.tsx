import { Text, View } from "react-native";
import type { Agent } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { ALL_CHATS, type ChatFilter, filtering } from "../viewPrefs";
import { Icon } from "./Icon";
import { AgentAvatar, BottomSheet, ListRow, Toggle } from "./kit";
import { makeStyles, useTheme } from "./theme";

/** What Chats shows: routine news and task chats on or off, and only the agents ticked. Each change applies at once. */
export function ChatFilterSheet({
  filter,
  agents,
  onChange,
  onClose,
}: {
  filter: ChatFilter;
  agents: Agent[];
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
  const check = (on: boolean) =>
    on ? <Icon name="Check" size={18} color={theme.brand} /> : <View style={{ width: 18 }} />;
  return (
    <BottomSheet title={t("filterChats")} onClose={onClose}>
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
          onPress={() => onChange(ALL_CHATS)}
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
