import { Text, View } from "react-native";
import { t } from "../../i18n";
import { Icon } from "../Icon";
import { Spinner } from "../kit";
import { makeStyles, useTheme } from "../theme";

export type ComputerStage = "creating" | "loading" | "ready";
const LABEL = { creating: "computerCreating", loading: "computerLoading", ready: "computerReady" } as const;

/** While the computer this chat's agent started comes up: set up the first time, booting, then ready for a moment. */
export function ComputerProgress({ stage }: { stage: ComputerStage }) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={[s.chip, stage === "ready" && s.ready]} accessibilityRole="text" accessibilityLiveRegion="polite">
      {stage === "ready" ? <Icon name="Check" size={13} color={theme.brandSoftFg} /> : <Spinner size={12} />}
      <Text style={[s.text, stage === "ready" && { color: theme.brandSoftFg }]}>{t(LABEL[stage])}</Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 12,
    marginVertical: 4,
    borderRadius: 14,
    backgroundColor: theme.fill,
  },
  ready: { backgroundColor: theme.brandSoft },
  text: { color: theme.fgMuted, fontSize: 12 },
}));
