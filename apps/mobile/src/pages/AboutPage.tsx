import Constants from "expo-constants";
import { useEffect, useMemo, useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { faces } from "../about/faces";
import { glyphHtml } from "../about/glyphHtml";
import { scenesFor } from "../about/scenes";
import { elapsed } from "../format";
import type { Health, Workspace } from "../hooks/useWorkspace";
import { type Key, lang, t } from "../i18n";
import { blobEyes } from "../ui/blobEyes";
import { Dot, ListGroup, ListRow, Screen, Spinner, SubHeader, type } from "../ui/kit";
import { theme } from "../ui/theme";

const STATUS: Record<Health["subsystems"][string]["status"], { label: Key; color: string }> = {
  ok: { label: "statusOk", color: theme.brand },
  degraded: { label: "statusDegraded", color: theme.warning },
  down: { label: "statusDown", color: theme.danger },
  off: { label: "statusOff", color: theme.fgSubtle },
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
        drawnWith: t("drawnWith"),
        background: theme.bg,
      }),
    [],
  );
  const config = Constants.expoConfig;
  const build = Platform.OS === "android" ? config?.android?.versionCode : config?.ios?.buildNumber;
  const health = server?.health;
  return (
    <View style={s.root}>
      <SubHeader title={t("about")} back={back} />
      {/* The portrait stays still under the finger; the information under it scrolls. */}
      <View style={s.portrait}>
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
      </View>
      <Screen gap={12}>
        <View style={s.intro}>
          <View style={s.brand}>
            <Image source={require("../../assets/logo.png")} style={s.logo} />
            <Text style={type.title}>APX</Text>
          </View>
          <Text style={s.tagline}>{t("aboutTagline")}</Text>
          <Text style={type.muted}>{t("aboutBody")}</Text>
        </View>
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
      </Screen>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  portrait: { height: 280, marginHorizontal: 8 },
  intro: { gap: 6, paddingHorizontal: 4, paddingTop: 8 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 26, height: 26 },
  tagline: { color: theme.brand, fontSize: 15, fontWeight: "500" },
  label: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 4, paddingTop: 8 },
  loading: { padding: 20, alignItems: "center" },
  code: { color: theme.fgMuted, fontFamily: theme.mono, fontSize: 12, maxWidth: 200 },
});
