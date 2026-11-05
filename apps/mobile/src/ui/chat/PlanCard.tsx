import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { t } from "../../i18n";
import type { PlanStep } from "../../protocol";
import { Icon } from "../Icon";
import { makeStyles, useTheme } from "../theme";

/**
 * An agent's plan as a checklist: each step pending, under way or done, with how many are done. The chat shows it at
 * the end of the agent's message, the task on its page; a plan that is not steps shows as written (`children`).
 */
export function PlanCard({ label, steps, children }: { label: string; steps?: PlanStep[]; children?: ReactNode }) {
  const theme = useTheme();
  const s = useStyles();
  const done = steps?.filter((step) => step.state === "done").length ?? 0;
  return (
    <View style={s.card} accessibilityLabel={label}>
      <View style={s.head}>
        <Icon name="ListChecks" size={14} color={theme.fgMuted} />
        <Text style={s.title}>{label}</Text>
        {steps ? <Text style={s.count}>{t("planDone", { done, count: steps.length })}</Text> : null}
      </View>
      <View style={s.list}>
        {steps
          ? steps.map((step, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a plan may repeat a step's words; its place is its identity
              <View key={i} style={s.step}>
                <Mark state={step.state} />
                <Text style={[s.text, step.state === "done" && s.done, step.state === "doing" && s.doing]}>
                  {step.step}
                </Text>
              </View>
            ))
          : children}
      </View>
    </View>
  );
}

function Mark({ state }: { state: PlanStep["state"] }) {
  const theme = useTheme();
  const s = useStyles();
  if (state === "done") return <Icon name="CircleCheck" size={16} color={theme.brand} />;
  return (
    <View style={[s.ring, state === "doing" && s.ringDoing]}>{state === "doing" ? <View style={s.dot} /> : null}</View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    alignSelf: "stretch",
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderColor: theme.border,
  },
  title: { flex: 1, color: theme.fg, fontSize: 13, fontWeight: "500" },
  count: { color: theme.fgSubtle, fontSize: 12 },
  list: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  text: { flex: 1, color: theme.fg, fontSize: 14, lineHeight: 19 },
  done: { color: theme.fgMuted, textDecorationLine: "line-through" },
  doing: { fontWeight: "600" },
  ring: {
    width: 16,
    height: 16,
    marginTop: 1,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.fgSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  ringDoing: { borderColor: theme.brand },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.brand },
}));
