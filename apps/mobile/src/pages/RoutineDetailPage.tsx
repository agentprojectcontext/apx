import { Pressable, StyleSheet, Text, View } from "react-native";
import { ago, clock, listWhen } from "../format";
import type { Routine, Workspace } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import { flowText, routineStatus, runOutcome, scheduleText } from "../routines/view";
import { Icon } from "../ui/Icon";
import { Card, ListGroup, Screen, Spinner, SubHeader, type } from "../ui/kit";
import { theme } from "../ui/theme";
import { Bars, type RoutineActions, RoutineToggle, RunNow, useRoutineRuns } from "./RoutinesPage";

const OUTCOME: Record<ReturnType<typeof runOutcome>, { label: Key; color: string }> = {
  told: { label: "rtTold", color: theme.brand },
  ran: { label: "rtRan", color: theme.brand },
  skipped: { label: "rtSkipped", color: theme.fgSubtle },
  failed: { label: "rtFailed", color: theme.danger },
  live: { label: "rtRunning", color: theme.info },
};

/** One routine: when and how it runs, what it does, and its last runs (each opens its conversation). */
export function RoutineDetailPage({
  routine,
  data,
  back,
  actions,
  openThread,
}: {
  routine: Routine;
  data: Workspace;
  back: () => void;
  actions: RoutineActions;
  openThread: (id: string) => void;
}) {
  const runs = useRoutineRuns(routine, actions.runs, 20);
  const agent = data.agents.find((item) => item.id === routine.agent_id);
  const project = data.projects.find((item) => item.id === routine.project_id)?.name ?? t("defaultProject");
  const status = routineStatus(routine, runs);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SubHeader title={routine.name} back={back} right={<RoutineToggle routine={routine} toggle={actions.toggle} />} />
      <Screen>
        <Card style={s.card}>
          <Text style={type.meta}>
            {project} · {scheduleText(routine.schedule)}
          </Text>
          <Text style={s.flow}>{flowText(routine, agent?.name ?? routine.agent_id)}</Text>
          <View style={s.row}>
            <Bars routine={routine} runs={runs} count={20} />
          </View>
          <View style={s.row}>
            <Text style={[type.meta, { flex: 1 }, status.bad && { color: theme.danger }]}>{status.text}</Text>
            <RunNow routine={routine} run={actions.run} />
          </View>
        </Card>
        {routine.prompt ? (
          <Card style={s.card}>
            <Text style={type.meta}>{t("rtPrompt")}</Text>
            <Text selectable style={type.body}>
              {routine.prompt}
            </Text>
          </Card>
        ) : null}
        <Text style={[type.meta, { paddingHorizontal: 4, paddingTop: 4 }]}>{t("rtRecent")}</Text>
        {runs.length ? (
          <ListGroup>
            {runs.map((run) => {
              const outcome = OUTCOME[runOutcome(run, routine.action)];
              return (
                <Pressable
                  key={run.run_id}
                  accessibilityRole="button"
                  onPress={() => openThread(run.thread_id)}
                  style={({ pressed }) => [s.run, pressed && { backgroundColor: theme.fill }]}
                >
                  <View style={s.mark}>
                    {outcome.label === "rtRunning" ? (
                      <Spinner size={14} color={outcome.color} />
                    ) : (
                      <Icon
                        name={outcome.label === "rtFailed" ? "TriangleAlert" : "Check"}
                        size={16}
                        color={outcome.color}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>
                      {listWhen(run.started_at)}
                      {listWhen(run.started_at).includes(":") ? "" : ` ${clock(run.started_at)}`}
                    </Text>
                    <Text style={[type.meta, { color: outcome.color }]}>{t(outcome.label)}</Text>
                  </View>
                  <Text style={type.meta}>{ago(run.started_at)}</Text>
                  <Icon name="ChevronRight" size={16} color={theme.fgSubtle} />
                </Pressable>
              );
            })}
          </ListGroup>
        ) : (
          <Text style={[type.muted, { paddingHorizontal: 4 }]}>{t("rtNoRuns")}</Text>
        )}
      </Screen>
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: 10 },
  flow: { color: theme.fgMuted, fontSize: 13, fontFamily: theme.mono },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  run: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  mark: { width: 20, alignItems: "center" },
});
