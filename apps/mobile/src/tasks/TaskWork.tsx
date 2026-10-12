import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ago } from "../format";
import { isWorking } from "../hooks/chatSelectors";
import type { Task, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { AgentAvatar, BottomSheet, ListRow, Spinner, useType } from "../ui/kit";

/**
 * A task's work: the chats its agents worked it in, one per agent that took it (a new assignee or an @mention adds
 * one), newest first. Each opens its chat. Without `sessions` it reads them with `load`.
 */
export function WorkSheet({
  task,
  data,
  sessions: given,
  load,
  openThread,
  onClose,
}: {
  task: Task;
  data: Workspace;
  sessions?: Thread[];
  load: (taskId: string) => Promise<{ sessions: Thread[] }>;
  openThread: (id: string) => void;
  onClose: () => void;
}) {
  const type = useType();
  const [read, setRead] = useState<Thread[]>();
  const sessions = given ?? read;
  useEffect(() => {
    if (given) return;
    void load(task.id)
      .then((detail) => setRead(detail.sessions))
      .catch(() => setRead([]));
  }, [given, load, task.id]);
  return (
    <BottomSheet title={t("tkWork")} onClose={onClose}>
      {!sessions ? (
        <View style={s.loading}>
          <Spinner size={18} />
        </View>
      ) : sessions.length ? (
        [...sessions].reverse().map((session) => (
          <WorkRow
            key={session.id}
            session={session}
            data={data}
            onPress={() => {
              onClose();
              openThread(session.id);
            }}
          />
        ))
      ) : (
        <Text style={[type.muted, s.none]}>{t(task.assignee ? "tkWorkNotYet" : "tkWorkNone")}</Text>
      )}
    </BottomSheet>
  );
}

function WorkRow({ session, data, onPress }: { session: Thread; data: Workspace; onPress: () => void }) {
  const type = useType();
  // The live list knows if it is working now; the task's copy is from when the page was read.
  const chat = data.threads.find((item) => item.id === session.id) ?? session;
  const agent = data.agents.find((item) => item.id === session.agent_ids[0]);
  const name = agent?.name ?? session.agent_ids[0] ?? "APX";
  const working = isWorking(chat.state);
  return (
    <ListRow
      label={name}
      sub={chat.preview || chat.title}
      leading={<AgentAvatar name={name} blob={agent?.blob} id={agent?.id ?? name} size={32} />}
      trailing={
        working ? (
          <View style={s.working}>
            <Spinner size={12} />
            <Text style={type.meta}>{t("tkWorkWorking")}</Text>
          </View>
        ) : (
          <Text style={type.meta}>{ago(chat.updated_at)}</Text>
        )
      }
      onPress={onPress}
    />
  );
}

const s = StyleSheet.create({
  loading: { padding: 24, alignItems: "center" },
  none: { paddingHorizontal: 16, paddingVertical: 12 },
  working: { flexDirection: "row", alignItems: "center", gap: 6 },
});
