import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Offline } from "../connectivity";
import { type Key, t } from "../i18n";
import { Icon } from "./Icon";
import { Button, EmptyState, Spinner } from "./kit";
import { makeStyles, useTheme } from "./theme";

const BODY: Record<Offline, Key> = {
  noInternet: "connNoInternet",
  tailscale: "connTailscale",
  localNetwork: "connLocal",
  server: "connServer",
};
const BANNER: Record<Offline, Key> = {
  noInternet: "connBannerNoInternet",
  tailscale: "connBannerTailscale",
  localNetwork: "connBannerLocal",
  server: "connBannerServer",
};

/** In place of the workspace when nothing could be loaded: why, and what to check. */
export function ConnectionEmpty({
  offline,
  host,
  checking,
  retry,
}: {
  offline: Offline;
  host: string;
  checking: boolean;
  retry: () => void;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <EmptyState
        icon={offline === "noInternet" ? "WifiOff" : "Plug"}
        tone="warning"
        title={t(offline === "noInternet" ? "connNoInternetTitle" : "connServerTitle")}
        body={t(BODY[offline], { host })}
      >
        <Button label={t("connRetry")} icon="RefreshCw" busy={checking} onPress={retry} />
      </EmptyState>
    </View>
  );
}

/** Over the last loaded workspace while the core is out of reach; a tap checks again. */
export function ConnectionBanner({
  offline,
  checking,
  retry,
}: {
  offline: Offline;
  checking: boolean;
  retry: () => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <Pressable accessibilityRole="button" onPress={retry} disabled={checking} style={s.banner}>
      {checking ? (
        <Spinner size={14} color={theme.warningSoftFg} />
      ) : (
        <Icon name={offline === "noInternet" ? "WifiOff" : "Plug"} size={14} color={theme.warningSoftFg} />
      )}
      <Text style={s.bannerText} numberOfLines={1}>
        {t(BANNER[offline])}
      </Text>
      <Icon name="RefreshCw" size={14} color={theme.warningSoftFg} />
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  screen: { flex: 1, justifyContent: "center", backgroundColor: theme.bg },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.warningSoft,
  },
  bannerText: { flex: 1, color: theme.warningSoftFg, fontSize: 13 },
}));
