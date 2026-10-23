import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useRoutineRuns } from "../hooks/useRoutineRuns";
import type { Routine, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import type { RoutineRun } from "../protocol";
import { activationSlots } from "../routines/slots";
import { flowText, routineStatus, runOutcome, scheduleText } from "../routines/view";
import { Icon } from "../ui/Icon";
import { AgentAvatar, EmptyState, Screen, Spinner, SubHeader, Toggle, useType } from "../ui/kit";
import { type ColorKey, makeStyles, useTheme } from "../ui/theme";

export type RoutineActions = {
  toggle: (routine: Routine, enabled: boolean) => Promise<void>;
  run: (id: string) => Promise<void>;
  runs: (id: string, limit?: number) => Promise<RoutineRun[]>;
};

const BAR: Record<ReturnType<typeof runOutcome> | "none", { color: ColorKey; height: number }> = {
  told: { color: "brand", height: 18 },
  ran: { color: "brand", height: 13 },
  live: { color: "info", height: 13 },
  skipped: { color: "fillStrong", height: 8 },
  none: { color: "fillStrong", height: 8 },
  failed: { color: "danger", height: 18 },
};

export { useRoutineRuns } from "../hooks/useRoutineRuns";

export function RoutinesPage({
  data,
  back,
  open,
  actions,
}: {
  data: Workspace;
  back: () => void;
  open: (routine: Routine) => void;
  actions: RoutineActions;
}) {
  const theme = useTheme();
  const active = data.routines.filter((routine) => routine.enabled).length;
  const routines = [...data.routines].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name),
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SubHeader title={t("routines")} back={back} right={t("rtSummary", { on: active, all: data.routines.length })} />
      <Screen>
        {routines.length ? (
          routines.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              data={data}
              actions={actions}
              onPress={() => open(routine)}
            />
          ))
        ) : (
          <EmptyState title={t("rtNone")} body={t("rtNoneBody")} icon="RefreshCw" />
        )}
      </Screen>
    </View>
  );
}

function RoutineCard({
  routine,
  data,
  actions,
  onPress,
}: {
  routine: Routine;
  data: Workspace;
  actions: RoutineActions;
  onPress: () => void;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const runs = useRoutineRuns(routine, actions.runs);
  const agent = data.agents.find((item) => item.id === routine.agent_id);
  const project = data.projects.find((item) => item.id === routine.project_id)?.name ?? t("defaultProject");
  const status = routineStatus(routine, runs);
  const usesAgent = routine.action === "agent" || routine.action === "watch" || routine.action === "mail";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.card,
        !routine.enabled && { opacity: 0.6 },
        pressed && { backgroundColor: theme.fill },
      ]}
    >
      <View style={s.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={s.name}>
            {routine.name}
          </Text>
          <Text numberOfLines={1} style={type.meta}>
            {project} · {scheduleText(routine.schedule)}
          </Text>
        </View>
        <RoutineToggle routine={routine} toggle={actions.toggle} />
      </View>
      <View style={s.flow}>
        {usesAgent && agent ? <AgentAvatar name={agent.name} blob={agent.blob} id={agent.id} size={16} /> : null}
        <Text numberOfLines={1} style={s.flowText}>
          {flowText(routine, agent?.name ?? routine.agent_id)}
        </Text>
      </View>
      <View style={s.bottom}>
        <Bars routine={routine} runs={runs} />
        <Text numberOfLines={1} style={[type.meta, { flex: 1 }, status.bad && { color: theme.danger }]}>
          {status.text}
        </Text>
        <RunNow routine={routine} run={actions.run} />
      </View>
    </Pressable>
  );
}

/** One bar per expected activation: green when it ran (taller when it told you), grey when skipped, red when failed. */
export function Bars({ routine, runs, count = 12 }: { routine: Routine; runs: RoutineRun[]; count?: number }) {
  const theme = useTheme();
  const s = useStyles();
  const slots = useMemo(
    () => activationSlots(routine.schedule, runs, new Date(), routine.next_run_at, count),
    [routine.schedule, routine.next_run_at, runs, count],
  );
  return (
    <View style={s.bars} accessibilityLabel={t("rtRecent")}>
      {slots.map((slot, i) => {
        const bar = BAR[slot.run ? runOutcome(slot.run, routine.action) : "none"];
        // Slots are fixed positions in the row.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional
        return <View key={i} style={[s.bar, { height: bar.height, backgroundColor: theme[bar.color] }]} />;
      })}
    </View>
  );
}

export function RoutineToggle({ routine, toggle }: { routine: Routine; toggle: RoutineActions["toggle"] }) {
  const [value, setValue] = useState(routine.enabled);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(routine.enabled), [routine.enabled]);
  return (
    <Toggle
      label={t("rtEnabled")}
      value={value}
      disabled={busy}
      onChange={(next) => {
        setValue(next);
        setBusy(true);
        toggle(routine, next)
          .catch((error) => {
            setValue(!next);
            Alert.alert(routine.name, error instanceof Error ? error.message : String(error));
          })
          .finally(() => setBusy(false));
      }}
    />
  );
}

export function RunNow({ routine, run }: { routine: Routine; run: RoutineActions["run"] }) {
  const theme = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("rtRunNow")}
      disabled={busy}
      onPress={() => {
        setBusy(true);
        run(routine.id)
          .catch((error) => Alert.alert(routine.name, error instanceof Error ? error.message : String(error)))
          .finally(() => setBusy(false));
      }}
      style={({ pressed }) => [s.play, pressed && { backgroundColor: theme.fillHover }]}
    >
      {busy ? <Spinner size={14} /> : <Icon name="Play" size={14} color={theme.fg} />}
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    padding: 14,
    gap: 10,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: theme.fg, fontSize: 15, fontWeight: "600", fontFamily: theme.mono },
  flow: { flexDirection: "row", alignItems: "center", gap: 6 },
  flowText: { color: theme.fgMuted, fontSize: 12, fontFamily: theme.mono, flexShrink: 1 },
  bottom: { flexDirection: "row", alignItems: "center", gap: 10 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 18 },
  bar: { width: 5, borderRadius: 2 },
  play: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.fill,
    alignItems: "center",
    justifyContent: "center",
  },
}));
