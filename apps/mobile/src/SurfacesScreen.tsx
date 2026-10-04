import { useEffect, useMemo, useRef, useState } from "react";
import { Button, FlatList, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { WebView } from "react-native-webview";
import type { Creds } from "./creds";
import { t } from "./i18n";
import { ApxClient, type Surface } from "./protocol";
import { readSurfaceMessage, surfaceDoc } from "./surfaceDoc";

/** Least time between two prompts from one widget, as in the panel. */
const PROMPT_GAP_MS = 1500;

type Summary = Omit<Surface, "html">;

/** The owner's pinned widgets and apps; one opens full screen, live from the core. */
export function SurfacesScreen({ creds, onBack }: { creds: Creds; onBack: () => void }) {
  const client = useMemo(
    () => new ApxClient({ url: creds.url, token: creds.token, client: { name: "apx-mobile", version: "0.0.0" } }),
    [creds],
  );
  const [list, setList] = useState<Summary[]>();
  const [open, setOpen] = useState<Surface>();
  useEffect(() => {
    client
      .call("surfaces.list", {})
      .then((r) => setList(r.surfaces.filter((s) => s.pinned || s.app)))
      .catch(() => setList([]));
  }, [client]);

  if (open) return <SurfaceView surface={open} client={client} onBack={() => setOpen(undefined)} />;
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("apps")}</Text>
        <Button title={t("chat")} onPress={onBack} />
      </View>
      <FlatList
        data={list ?? []}
        keyExtractor={(s) => s.id}
        ListEmptyComponent={list ? <Text style={styles.empty}>{t("noApps")}</Text> : null}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => void client.call("surfaces.get", { surface: item.id }).then(setOpen)}
          >
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowName}>{item.name}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function SurfaceView({ surface, client, onBack }: { surface: Surface; client: ApxClient; onBack: () => void }) {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const nonce = useMemo(() => Math.random().toString(36).slice(2) + Date.now().toString(36), []);
  const html = useMemo(() => surfaceDoc(surface.html, { mode, nonce }), [surface.html, mode, nonce]);
  const last = useRef(0);
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {surface.title}
        </Text>
        <Button title={t("back")} onPress={onBack} />
      </View>
      <WebView
        originWhitelist={["about:blank"]}
        source={{ html }}
        javaScriptEnabled
        // A widget never navigates anywhere: only its own document loads.
        onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url.startsWith("data:")}
        setSupportMultipleWindows={false}
        onMessage={(e) => {
          const m = readSurfaceMessage(e.nativeEvent.data, nonce);
          if (!m || Date.now() - last.current < PROMPT_GAP_MS) return;
          last.current = Date.now();
          void client.call("surfaces.prompt", { surface: surface.id, text: m.prompt }).catch(() => {});
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12 },
  title: { fontSize: 17, fontWeight: "600", flexShrink: 1 },
  empty: { padding: 20, opacity: 0.6 },
  row: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#d6d4ce" },
  rowTitle: { fontSize: 16, fontWeight: "500" },
  rowName: { fontSize: 12, opacity: 0.6 },
});
