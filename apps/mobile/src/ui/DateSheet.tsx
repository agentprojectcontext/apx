import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { lang, t } from "../i18n";
import { clockValue, dayValue, monthWeeks, withTime } from "../tasks/calendar";
import { duePresets, momentOf } from "../tasks/when";
import { BottomSheet, Button, Chip, IconButton, type } from "./kit";
import { theme } from "./theme";

const TIMES = ["08:00", "10:00", "12:00", "15:00", "18:00", "20:00"];
const locale = lang === "es" ? "es" : "en";

/**
 * A day, and optionally a time, picked on the phone: quick days, the month, then the hour. Values are the board's
 * picker values ("2026-10-05", or "2026-10-05T18:00"): a bare day is 09:00 for the core.
 */
export function DateSheet({
  title,
  value,
  time: timeMode = "optional",
  onPick,
  onClose,
}: {
  title: string;
  value?: string;
  /** "optional": a bare day or a time; "required": always a time (a routine that runs once). */
  time?: "optional" | "required";
  /** The new value, or undefined when the owner clears it. */
  onPick: (value: string | undefined) => void;
  onClose: () => void;
}) {
  const start = value ? momentOf(value) : new Date();
  const [day, setDay] = useState(value?.split("T")[0]);
  const [time, setTime] = useState(value?.split("T")[1] ?? (timeMode === "required" ? "09:00" : undefined));
  const [view, setView] = useState({ year: start.getFullYear(), month: start.getMonth() });
  const [typed, setTyped] = useState(time && !TIMES.includes(time) ? time : "");
  const weeks = useMemo(() => monthWeeks(view.year, view.month), [view]);
  const today = dayValue(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const presets = duePresets();
  const names = { today: t("today"), tomorrow: t("tomorrow"), monday: t("dtMonday") };
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    // 2026-10-05 is a Monday.
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(2026, 9, 5 + i)));
  }, []);
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(view.year, view.month, 1),
  );
  const shift = (n: number) =>
    setView(({ year, month }) => {
      const d = new Date(year, month + n, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  const pickDay = (value: string) => {
    setDay(value);
    const d = momentOf(value);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };
  return (
    <BottomSheet title={title} onClose={onClose}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {presets.map((preset) => (
          <Chip
            key={preset.key}
            label={names[preset.key]}
            selected={day === preset.value}
            onPress={() => pickDay(preset.value)}
          />
        ))}
      </ScrollView>
      <View style={s.month}>
        <IconButton icon="ChevronLeft" label={t("dtPrevMonth")} size={18} onPress={() => shift(-1)} />
        <Text style={[type.body, s.monthTitle]}>{monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1)}</Text>
        <IconButton icon="ChevronRight" label={t("dtNextMonth")} size={18} onPress={() => shift(1)} />
      </View>
      <View style={s.week}>
        {weekdays.map((name, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two weekdays share an initial.
          <Text key={i} style={[type.meta, s.weekday]}>
            {name.toUpperCase()}
          </Text>
        ))}
      </View>
      {weeks.map((week, w) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: weeks are positions in the month.
        <View key={w} style={s.week}>
          {week.map((n, i) => {
            // biome-ignore lint/suspicious/noArrayIndexKey: a blank has no day; its place in the week is its key.
            if (!n) return <View key={`blank-${i}`} style={s.cell} />;
            const value = dayValue(view.year, view.month, n);
            const on = value === day;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setDay(value)}
                style={s.cell}
              >
                <View style={[s.dayCircle, value === today && s.today, on && s.picked]}>
                  <Text style={[s.dayText, on && { color: theme.accentFg, fontWeight: "600" }]}>{n}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={[type.meta, s.label]}>{t("dtTime")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {timeMode === "optional" ? (
          <Chip label={t("dtNoTime")} selected={!time} onPress={() => setTime(undefined)} />
        ) : null}
        {TIMES.map((option) => (
          <Chip key={option} label={option} selected={time === option} onPress={() => setTime(option)} />
        ))}
        <TextInput
          value={typed}
          onChangeText={(text) => {
            setTyped(text);
            const clock = clockValue(text);
            if (clock) setTime(clock);
          }}
          placeholder={t("dtOther")}
          placeholderTextColor={theme.fgSubtle}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          style={[s.timeInput, time && time === clockValue(typed) && s.timeInputOn]}
        />
      </ScrollView>
      <View style={s.actions}>
        {value ? (
          <Button
            label={t("dtClear")}
            variant="secondary"
            onPress={() => {
              onClose();
              onPick(undefined);
            }}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        <Button
          label={t("save")}
          disabled={!day}
          onPress={() => {
            if (!day) return;
            onClose();
            onPick(withTime(day, time));
          }}
        />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  chips: { gap: 8, paddingHorizontal: 8, paddingVertical: 4 },
  month: { flexDirection: "row", alignItems: "center", paddingTop: 6 },
  monthTitle: { flex: 1, textAlign: "center", fontWeight: "600" },
  week: { flexDirection: "row", paddingHorizontal: 4 },
  weekday: { flex: 1, textAlign: "center", paddingVertical: 4 },
  cell: { flex: 1, height: 42, alignItems: "center", justifyContent: "center" },
  dayCircle: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 1, borderColor: theme.borderStrong },
  picked: { backgroundColor: theme.accent, borderColor: theme.accent },
  dayText: { color: theme.fg, fontSize: 14 },
  label: { paddingHorizontal: 12, paddingTop: 10 },
  timeInput: {
    height: 32,
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 0,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    color: theme.fg,
    fontSize: 13,
    textAlign: "center",
  },
  timeInputOn: { borderColor: theme.accent },
  actions: { flexDirection: "row", gap: 8, padding: 8, paddingTop: 14 },
});
