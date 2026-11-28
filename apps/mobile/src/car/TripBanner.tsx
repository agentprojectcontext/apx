import { Pressable, Text } from "react-native";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { makeStyles, useTheme } from "../ui/theme";

/** While a trip is on: one line that opens the trip, with how many errands wait for an answer. */
export function TripBanner({ waiting, onPress }: { waiting: number; onPress: () => void }) {
  const theme = useTheme();
  const s = useStyles();
  const label = waiting ? `${t("carTripOn")} · ${t("carNearby", { n: waiting })}` : t("carTripOn");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.banner, pressed && { opacity: 0.8 }]}
    >
      <Icon name="Car" size={16} color={theme.tones.brand.fg} />
      <Text numberOfLines={1} style={s.text}>
        {label}
      </Text>
      <Icon name="ChevronRight" size={16} color={theme.tones.brand.fg} />
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: theme.tones.brand.bg,
  },
  text: { flex: 1, color: theme.tones.brand.fg, fontSize: 14, fontWeight: "600" },
}));
