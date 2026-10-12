import Constants from "expo-constants";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Text, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { faces } from "../about/faces";
import { glyphHtml } from "../about/glyphHtml";
import { scenesFor } from "../about/scenes";
import { elapsed } from "../format";
import type { Health, Workspace } from "../hooks/useWorkspace";
import { type Key, lang, t } from "../i18n";
import { blobEyes } from "../ui/blobEyes";
import { Dot, ListGroup, ListRow, Spinner, SubHeader, useType } from "../ui/kit";
import { type ColorKey, makeStyles, useTheme } from "../ui/theme";

const STATUS: Record<Health["subsystems"][string]["status"], { label: Key; color: ColorKey }> = {
  ok: { label: "statusOk", color: "brand" },
  degraded: { label: "statusDegraded", color: "warning" },
  down: { label: "statusDown", color: "danger" },
  off: { label: "statusOff", color: "fgSubtle" },
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The portrait's height, the version badge under it, the title bar's height, and the portrait's size up there. */
const PORTRAIT = 250;
const BADGE = 30;
const BAR = 56;
const SMALL = 44;

/** What APX is, drawn as on the landing, with this build and the core it talks to (as `apx status` says it). */
export function AboutPage({
  data,
  url,
  back,
  load,
}: {
  data: Workspace;
  url: string;
  back: () => void;
  load: () => Promise<{ health: Health; devices?: number }>;
}) {
  const theme = useTheme();
  const type = useType();
  const s = useStyles();
  const [server, setServer] = useState<{ health: Health; devices?: number } | null>();
  useEffect(() => {
    void load()
      .then(setServer)
      .catch(() => setServer(null));
  }, [load]);
  const html = useMemo(
    () =>
      glyphHtml({
        scenes: scenesFor(lang),
        faces,
        eyes: blobEyes,
        background: "transparent",
      }),
    [],
  );
  const scroll = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();
  // While the page scrolls, the portrait shrinks and flies into the title bar, on the side opposite the back arrow.
  const fromX = width / 2;
  const fromY = BAR + PORTRAIT / 2;
  const toX = width - 16 - SMALL / 2;
  const toY = BAR / 2;
  const fly = { inputRange: [0, PORTRAIT], extrapolate: "clamp" as const };
  const portraitX = scroll.interpolate({ ...fly, outputRange: [0, toX - fromX] });
  const portraitY = scroll.interpolate({ ...fly, outputRange: [0, toY - fromY] });
  const portraitScale = scroll.interpolate({ ...fly, outputRange: [1, SMALL / PORTRAIT] });
  // The version badge is not shrunk with the portrait: it fades out, and the version shows again in the list.
  const badge = scroll.interpolate({ inputRange: [0, 40], outputRange: [1, 0], extrapolate: "clamp" });
  const config = Constants.expoConfig;
  const build = Platform.OS === "android" ? config?.android?.versionCode : config?.ios?.buildNumber;
  const health = server?.health;
  return (
    <View style={s.root}>
      <SubHeader title={t("about")} back={back} />
      <View style={s.body}>
        <Animated.ScrollView
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scroll } } }], { useNativeDriver: true })}
          contentContainerStyle={s.content}
        >
          {/* Room for the portrait, which floats over the page; the badge scrolls away under the title bar. */}
          <Animated.View pointerEvents="none" style={[s.badgeRow, { opacity: badge }]}>
            <Text style={s.badge}>{t("apxVersion", { version: config?.version ?? "" })}</Text>
          </Animated.View>
          <Text style={s.label}>{t("thisApp")}</Text>
          <ListGroup>
            <ListRow label={t("appVersion")} detail={config?.version ?? "—"} chevron={false} />
            <ListRow label={t("appBuild")} detail={build === undefined ? "—" : String(build)} chevron={false} />
            <ListRow
              label={t("platform")}
              detail={`${Platform.OS === "ios" ? "iOS" : "Android"} ${Platform.Version}`}
              chevron={false}
            />
          </ListGroup>
          <Text style={s.label}>{t("server")}</Text>
          {server === undefined ? (
            <View style={s.loading}>
              <Spinner size={18} />
            </View>
          ) : !health ? (
            <Text style={[type.muted, { paddingHorizontal: 4 }]}>{t("serverUnreachable")}</Text>
          ) : (
            <>
              <ListGroup>
                <ListRow
                  label={t("core")}
                  detail={health.version === "0.0.0" ? t("devBuild") : `v${health.version}`}
                  chevron={false}
                />
                <ListRow
                  label={t("commit")}
                  trailing={<Text style={s.code}>{health.code_sha.slice(0, 12)}</Text>}
                  chevron={false}
                />
                <ListRow
                  label={t("coreAddress")}
                  trailing={
                    <Text numberOfLines={1} style={s.code}>
                      {url}
                    </Text>
                  }
                  chevron={false}
                />
                <ListRow label={t("upFor")} detail={elapsed(health.started_at)} chevron={false} />
                {health.rss_mb !== undefined ? (
                  <ListRow label={t("coreMemory")} detail={`${health.rss_mb} MB`} chevron={false} />
                ) : null}
              </ListGroup>
              <Text style={s.label}>{t("subsystems")}</Text>
              <ListGroup>
                {Object.entries(health.subsystems).map(([name, sub]) => (
                  <ListRow
                    key={name}
                    label={capital(name)}
                    sub={sub.detail}
                    detail={t(STATUS[sub.status].label)}
                    leading={<Dot color={theme[STATUS[sub.status].color]} />}
                    chevron={false}
                  />
                ))}
              </ListGroup>
              <Text style={s.label}>{t("crew")}</Text>
              <ListGroup>
                <ListRow label={t("agents")} detail={String(data.agents.length)} chevron={false} />
                <ListRow
                  label={t("projects")}
                  detail={String(data.projects.filter((p) => p.registered !== false).length)}
                  chevron={false}
                />
                <ListRow label={t("navChats")} detail={String(data.threads.length)} chevron={false} />
                {server?.devices !== undefined ? (
                  <ListRow label={t("pairedDevices")} detail={String(server.devices)} chevron={false} />
                ) : null}
              </ListGroup>
            </>
          )}
          <Text style={[type.small, { textAlign: "center", paddingTop: 8 }]}>{t("aboutApc")}</Text>
        </Animated.ScrollView>
      </View>
      <Animated.View
        style={[
          s.portrait,
          {
            width: width - 16,
            transform: [{ translateX: portraitX }, { translateY: portraitY }, { scale: portraitScale }],
          },
        ]}
      >
        <WebView
          source={{ html }}
          originWhitelist={["about:blank"]}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          style={{ backgroundColor: "transparent" }}
        />
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1, overflow: "hidden" },
  content: { paddingTop: PORTRAIT, paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  portrait: { position: "absolute", top: BAR, left: 8, height: PORTRAIT },
  badgeRow: { height: BADGE, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  badge: {
    color: theme.fgMuted,
    fontFamily: theme.mono,
    fontSize: 11,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: "hidden",
  },
  label: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 4, paddingTop: 8 },
  loading: { padding: 20, alignItems: "center" },
  code: { color: theme.fgMuted, fontFamily: theme.mono, fontSize: 12, maxWidth: 200 },
}));
