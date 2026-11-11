// A routine's chat shows one run at a time: this sheet switches to another of its runs, or opens the routine itself.
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { runChoices } from "../../chat/routineRuns";
import { clock, dayLabel } from "../../format";
import { chatPreview, isWorking } from "../../hooks/chatSelectors";
import type { Thread } from "../../hooks/useWorkspace";
import { t } from "../../i18n";
import type { RoutineRun } from "../../protocol";
import { Icon } from "../Icon";
import { BottomSheet, CountBadge, ListRow, Spinner } from "../kit";
import { makeStyles, useTheme } from "../theme";

/** The runs the core is asked for at once: enough to go back a few weeks of a daily routine. */
const RUNS = 60;

/** When a run happened, as its row and the chat's header say it: "Today · 09:00". */
export const runWhen = (iso: string) => `${dayLabel(iso)} · ${clock(iso)}`;

export function RoutineRunsSheet({
  thread,
  threads,
  name,
  loadRuns,
  onPick,
  onRoutine,
  onClose,
}: {
  /** The run on screen. */
  thread: Thread;
  threads: readonly Thread[];
  name: string;
  loadRuns?: (routineId: string, limit?: number) => Promise<RoutineRun[]>;
  onPick: (threadId: string) => void;
  /** Opens the routine's page (schedule, on or off, run now); missing when the phone does not know it. */
  onRoutine?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [loading, setLoading] = useState(Boolean(loadRuns && thread.routine_id));
  useEffect(() => {
    if (!loadRuns || !thread.routine_id) return;
    let live = true;
    void loadRuns(thread.routine_id, RUNS)
      .then((list) => live && setRuns(list))
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [loadRuns, thread.routine_id]);
  const choices = useMemo(() => runChoices(thread, threads, runs), [thread, threads, runs]);
  return (
    <BottomSheet title={name} onClose={onClose}>
      {(dismiss) => (
        <>
          {onRoutine ? (
            <ListRow
              label={t("rtOpenRoutine")}
              leading={<Icon name="Settings" size={18} color={theme.fgMuted} />}
              onPress={() => dismiss(onRoutine)}
            />
          ) : null}
          <View style={s.label}>
            <Text style={s.labelText}>{t("rtPastRuns", { n: choices.length })}</Text>
            {loading ? <Spinner size={12} /> : null}
          </View>
          {choices.map((choice) => {
            const current = choice.thread_id === thread.id;
            const said = chatPreview({ ...thread, preview: choice.preview });
            return (
              <Pressable
                key={choice.thread_id}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                onPress={() => dismiss(() => !current && onPick(choice.thread_id))}
                style={({ pressed }) => [s.run, current && s.current, pressed && { backgroundColor: theme.fill }]}
              >
                <View style={[s.mark, { backgroundColor: markColor(choice.state, theme) }]} />
                <View style={s.copy}>
                  <Text numberOfLines={1} style={[s.when, choice.unread > 0 && { fontWeight: "600" }]}>
                    {runWhen(choice.at)}
                  </Text>
                  <Text numberOfLines={1} style={s.said}>
                    {choice.state === "failed" ? t("inboxFailed") : said || t("rtRunQuiet")}
                  </Text>
                </View>
                {isWorking(choice.state) ? <Spinner size={12} /> : null}
                {choice.unread > 0 ? <CountBadge count={choice.unread} small /> : null}
                {current ? <Icon name="Check" size={16} color={theme.brand} /> : null}
              </Pressable>
            );
          })}
        </>
      )}
    </BottomSheet>
  );
}

const markColor = (state: string, theme: ReturnType<typeof useTheme>) =>
  state === "failed" ? theme.danger : isWorking(state) ? theme.info : theme.brand;

const useStyles = makeStyles((theme) => ({
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  labelText: { color: theme.fgSubtle, fontSize: 12 },
  run: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, paddingHorizontal: 20 },
  current: { backgroundColor: theme.fill },
  mark: { width: 8, height: 8, borderRadius: 4 },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  when: { color: theme.fg, fontSize: 14, fontWeight: "500" },
  said: { color: theme.fgMuted, fontSize: 12 },
}));
