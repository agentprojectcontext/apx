import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ago } from "../format";
import { isWorking } from "../hooks/chatSelectors";
import type { Task, TaskUsage, Thread, Workspace } from "../hooks/useWorkspace";
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
  usage: givenUsage,
  load,
  openThread,
  onClose,
}: {
  task: Task;
  data: Workspace;
  sessions?: Thread[];
  usage?: TaskUsage[];
  load: (taskId: string) => Promise<{ sessions: Thread[]; usage?: TaskUsage[] }>;
  openThread: (id: string) => void;
  onClose: () => void;
}) {
  const type = useType();
  const [read, setRead] = useState<Thread[]>();
  const [readUsage, setReadUsage] = useState<TaskUsage[]>();
  const sessions = given ?? read;
  const usage = givenUsage ?? readUsage ?? [];
  useEffect(() => {
    if (given) return;
    void load(task.id)
      .then((detail) => {
        setRead(detail.sessions);
        setReadUsage(detail.usage);
      })
      .catch(() => setRead([]));
  }, [given, load, task.id]);
  const tokens = usage.reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output }), {
    input: 0,
    output: 0,
  });
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
      {tokens.input + tokens.output ? (
        <Text style={[type.meta, s.none]}>
          {t("tkUsage", { input: tokens.input.toLocaleString(), output: tokens.output.toLocaleString() })}
        </Text>
      ) : null}
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
      label={session.kind === "a2a" ? `${name} · ${t("tkConsult")}` : name}
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
