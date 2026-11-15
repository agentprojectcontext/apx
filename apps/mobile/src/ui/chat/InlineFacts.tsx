import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { t } from "../../i18n";
import { copyText } from "../copy";
import { Icon } from "../Icon";
import { Chip, Dot, Segmented } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { type Of, toneOf } from "./InlineParts";

/** A view's title, what it is about, and a short note (when its prices were read) on the right. */
export function Head({ node }: { node: Of<"head"> }) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={s.head}>
      <View style={s.headText}>
        <Text style={s.headTitle}>{node.title}</Text>
        {node.subtitle && <Text style={s.headSub}>{node.subtitle}</Text>}
      </View>
      {node.note && (
        <View style={s.note}>
          <Dot color={theme.subtle} size={6} />
          <Text style={s.noteText}>{node.note}</Text>
        </View>
      )}
    </View>
  );
}

export function Status({ node }: { node: Of<"status"> }) {
  const theme = useTheme();
  const s = useStyles();
  const c = theme.tones[toneOf(node.tone)];
  return (
    <View style={s.statusRow}>
      <View style={[s.status, { backgroundColor: c.bg }]}>
        {node.tone === "success" && <Icon name="Check" size={13} color={c.fg} strokeWidth={2.4} />}
        <Text style={[s.statusText, { color: c.fg }]}>{node.label}</Text>
      </View>
      {node.when && <Text style={s.muted}>{node.when}</Text>}
    </View>
  );
}

/** A code to keep (a booking's), to copy and paste elsewhere. */
export function Code({ node }: { node: Of<"code"> }) {
  const s = useStyles();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{node.label}</Text>
      <Text selectable style={s.code}>
        {node.value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("copyText")} ${node.value}`}
        hitSlop={8}
        onPress={() => void copyText(node.value).then(() => setDone(true))}
      >
        <Text style={s.copy}>{done ? t("copied") : t("copyText")}</Text>
      </Pressable>
    </View>
  );
}

export function Steps({ node }: { node: Of<"steps"> }) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={s.steps} accessibilityLabel={t("inlineSteps", { done: node.done, total: node.total })}>
      {Array.from({ length: node.total }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one dot per step, in order
        <Dot key={i} size={8} color={i < node.done ? theme.brand : theme.borderStrong} />
      ))}
    </View>
  );
}

/** A plan by days: one tab per day, its items on a timeline. */
export function Agenda({ node }: { node: Of<"agenda"> }) {
  const s = useStyles();
  const [day, setDay] = useState("0");
  const shown = node.days[Number(day)] ?? node.days[0];
  const options = node.days.map((d, i) => ({ value: String(i), label: d.label }));
  return (
    <View style={s.agenda}>
      {options.length > 1 &&
        (options.length <= 3 ? (
          <Segmented value={day} options={options} onChange={setDay} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {options.map((o) => (
              <Chip key={o.value} label={o.label} selected={o.value === day} onPress={() => setDay(o.value)} />
            ))}
          </ScrollView>
        ))}
      <View>
        {shown?.items.map((item, i, all) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a day's items keep their order
          <View key={i} style={s.item}>
            <Text style={s.time}>{item.time ?? ""}</Text>
            <View style={s.track}>
              <View style={[s.dot, item.done && s.dotDone]} />
              {i < all.length - 1 && <View style={s.line} />}
            </View>
            <View style={s.itemBody}>
              <Text style={s.itemTitle}>{item.title}</Text>
              {item.meta && <Text style={s.muted}>{item.meta}</Text>}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  headTitle: { color: theme.fg, fontSize: 15, fontWeight: "600" },
  headSub: { color: theme.muted, fontSize: 13 },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: theme.fill,
  },
  noteText: { color: theme.muted, fontSize: 11 },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusText: { fontSize: 12, fontWeight: "600" },
  muted: { color: theme.muted, fontSize: 12 },
  field: { flexDirection: "row", alignItems: "center", gap: 16 },
  fieldLabel: { color: theme.subtle, fontSize: 13, minWidth: 80, maxWidth: "40%" },
  code: { flex: 1, color: theme.fg, fontSize: 14, fontFamily: theme.mono, fontWeight: "600" },
  copy: { color: theme.brandSoftFg, fontSize: 13, fontWeight: "600" },
  steps: { flexDirection: "row", gap: 6, paddingVertical: 2 },
  agenda: { gap: 10 },
  chips: { gap: 6 },
  item: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  time: {
    width: 52,
    paddingTop: 1,
    textAlign: "right",
    color: theme.subtle,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  track: { width: 14, alignSelf: "stretch", alignItems: "center" },
  dot: {
    width: 10,
    height: 10,
    marginTop: 4,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.borderStrong,
    backgroundColor: theme.surface,
  },
  dotDone: { borderColor: theme.brand, backgroundColor: theme.brand },
  // Runs past the row's padding to the next item's dot.
  line: { position: "absolute", top: 16, bottom: -10, width: 2, backgroundColor: theme.border },
  itemBody: { flex: 1, minWidth: 0, gap: 2 },
  itemTitle: { color: theme.fg, fontSize: 13, fontWeight: "600" },
}));
