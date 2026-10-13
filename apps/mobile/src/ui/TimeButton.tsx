import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, Text } from "react-native";
import { t } from "../i18n";
import { BottomSheet, Button } from "./kit";
import { makeStyles, useTheme } from "./theme";

const toDate = (clock: string) => {
  const [h = 0, m = 0] = clock.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};
const toClock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** A labelled time ("From 22:00") that opens the phone's own time picker; `value` is "HH:MM", or none yet. */
export function TimeButton({
  label,
  value,
  fallback,
  onPick,
}: {
  label: string;
  value?: string;
  /** Where the picker starts when there is no value yet. */
  fallback: string;
  onPick: (clock: string) => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [sheet, setSheet] = useState<Date>();
  const open = () => {
    const start = toDate(value ?? fallback);
    if (Platform.OS === "android")
      DateTimePickerAndroid.open({
        value: start,
        mode: "time",
        is24Hour: true,
        onChange: (event, date) => {
          if (event.type === "set" && date) onPick(toClock(date));
        },
      });
    else setSheet(start);
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value ?? ""}`}
        onPress={open}
        style={({ pressed }) => [s.button, value ? s.on : null, pressed && { opacity: 0.8 }]}
      >
        <Text style={[s.label, value ? { color: theme.accentFg } : null]}>{label}</Text>
        <Text style={[s.value, value ? { color: theme.accentFg } : null]}>{value ?? "--:--"}</Text>
      </Pressable>
      {sheet ? (
        <BottomSheet title={label} onClose={() => setSheet(undefined)}>
          <DateTimePicker
            value={sheet}
            mode="time"
            display="spinner"
            is24Hour
            onChange={(_, date) => date && setSheet(date)}
          />
          <Button
            label={t("done")}
            onPress={() => {
              onPick(toClock(sheet));
              setSheet(undefined);
            }}
          />
        </BottomSheet>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((theme) => ({
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
  },
  on: { backgroundColor: theme.accent, borderColor: theme.accent },
  label: { color: theme.fgMuted, fontSize: 14 },
  value: { color: theme.fg, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
}));
