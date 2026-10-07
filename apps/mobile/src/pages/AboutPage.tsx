import Constants from "expo-constants";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { WebView } from "react-native-webview";
import { faces } from "../about/faces";
import { glyphHtml } from "../about/glyphHtml";
import { scenesFor } from "../about/scenes";
import { elapsed } from "../format";
import type { Health, Workspace } from "../hooks/useWorkspace";
import { type Key, lang, t } from "../i18n";
import { blobEyes } from "../ui/blobEyes";
import { CHANNEL_MARKS } from "../ui/channelMarks";
import { Dot, ListGroup, ListRow, Spinner, SubHeader, type } from "../ui/kit";
import { theme } from "../ui/theme";

const STATUS: Record<Health["subsystems"][string]["status"], { label: Key; color: string }> = {
  ok: { label: "statusOk", color: theme.brand },
  degraded: { label: "statusDegraded", color: theme.warning },
  down: { label: "statusDown", color: theme.danger },
  off: { label: "statusOff", color: theme.fgSubtle },
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const DISCORD = "https://discord.gg/vxdZuT5WuE";
/** The portrait's full height, the height it shrinks to while scrolling, and its size then. */
const TALL = 280;
const SHORT = 150;
const SHRINK = SHORT / TALL;

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
        caption: t("apxVersion", { version: Constants.expoConfig?.version ?? "" }),
        background: theme.bg,
      }),
    [],
  );
  const scroll = useRef(new Animated.Value(0)).current;
  const fold = TALL - SHORT;
  // The header slides up by `fold` while the portrait shrinks and moves down to stay centred in what is left.
  const headerY = scroll.interpolate({ inputRange: [0, fold], outputRange: [0, -fold], extrapolate: "clamp" });
  const portraitY = scroll.interpolate({ inputRange: [0, fold], outputRange: [0, fold / 2], extrapolate: "clamp" });
  const portraitScale = scroll.interpolate({ inputRange: [0, fold], outputRange: [1, SHRINK], extrapolate: "clamp" });
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
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(DISCORD)}
            style={({ pressed }) => [s.discord, pressed && { opacity: 0.85 }]}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24">
              {CHANNEL_MARKS.discord.paths.map((path) => (
                <Path key={path.d.slice(0, 12)} d={path.d} fill="#fff" />
              ))}
            </Svg>
            <Text style={s.discordText}>{t("joinDiscord")}</Text>
          </Pressable>
          <Text style={s.label}>{t("thisApp")}</Text>
          <ListGroup>
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
                    leading={<Dot color={STATUS[sub.status].color} />}
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
        {/* Over the list: tall at first, then a small portrait pinned to the top while the rest scrolls. */}
        <Animated.View style={[s.header, { transform: [{ translateY: headerY }] }]}>
          <Animated.View style={[s.portrait, { transform: [{ translateY: portraitY }, { scale: portraitScale }] }]}>
            <WebView
              source={{ html }}
              originWhitelist={["about:blank"]}
              onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
              scrollEnabled={false}
              bounces={false}
              overScrollMode="never"
              setSupportMultipleWindows={false}
              style={{ backgroundColor: theme.bg }}
            />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1, overflow: "hidden" },
  content: { paddingTop: TALL + 8, paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  header: { position: "absolute", top: 0, left: 0, right: 0, height: TALL, backgroundColor: theme.bg },
  portrait: { flex: 1, marginHorizontal: 8 },
  discord: {
    height: 48,
    borderRadius: 24,
    backgroundColor: "#5865F2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  discordText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  label: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 4, paddingTop: 8 },
  loading: { padding: 20, alignItems: "center" },
  code: { color: theme.fgMuted, fontFamily: theme.mono, fontSize: 12, maxWidth: 200 },
});
