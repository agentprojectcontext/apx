import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import type { Params } from "../../../packages/protocol/src/index.ts";
import { APP_CLIENT } from "./appInfo";
import type { Creds } from "./creds";
import { t } from "./i18n";
import { ApxClient, type Surface } from "./protocol";
import { readSurfaceMessage, surfaceDoc, surfaceResult } from "./surfaceDoc";
import { EmptyState, IconTile, ListGroup, ListRow, Screen, Spinner, SubHeader } from "./ui/kit";
import { makeStyles, useTheme } from "./ui/theme";

/** Least time between two prompts from one widget, as in the panel. */
const PROMPT_GAP_MS = 1500;
/** Bridge calls (store, db) one page may have waiting at once, as in the panel. */
const CALLS_MAX = 16;

type Summary = Omit<Surface, "html">;

/** The owner's pinned widgets and apps; one opens full screen, live from the core. */
export function SurfacesScreen({ creds, onBack }: { creds: Creds; onBack: () => void }) {
  const styles = useStyles();
  const client = useMemo(() => new ApxClient({ url: creds.url, token: creds.token, client: APP_CLIENT }), [creds]);
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
    <View style={styles.root}>
      <SubHeader title={t("apps")} back={onBack} />
      <Screen>
        {list === undefined ? (
          <View style={styles.loading}>
            <Spinner size={20} />
          </View>
        ) : list.length ? (
          <ListGroup>
            {list.map((item) => (
              <ListRow
                key={item.id}
                label={item.title}
                sub={item.name}
                leading={<IconTile icon="LayoutGrid" tone="brand" />}
                onPress={() => void client.call("surfaces.get", { surface: item.id }).then(setOpen)}
              />
            ))}
          </ListGroup>
        ) : (
          <EmptyState title={t("apps")} body={t("noApps")} icon="LayoutGrid" />
        )}
      </Screen>
    </View>
  );
}

function SurfaceView({ surface, client, onBack }: { surface: Surface; client: ApxClient; onBack: () => void }) {
  const theme = useTheme();
  const styles = useStyles();
  // A widget is drawn in the app's scheme.
  const nonce = useMemo(() => Math.random().toString(36).slice(2) + Date.now().toString(36), []);
  const html = useMemo(
    () => surfaceDoc(surface.html, { mode: theme.scheme, nonce, layout: surface.app ? "app" : "widget" }),
    [surface.html, surface.app, nonce, theme.scheme],
  );
  const last = useRef(0);
  const view = useRef<WebView>(null);
  const inFlight = useRef(0);
  const answer = (r: Parameters<typeof surfaceResult>[1]) => view.current?.injectJavaScript(surfaceResult(nonce, r));
  return (
    <View style={styles.root}>
      <SubHeader title={surface.title} back={onBack} />
      <WebView
        ref={view}
        style={{ backgroundColor: theme.bg }}
        originWhitelist={["about:blank"]}
        source={{ html }}
        javaScriptEnabled
        // A widget never navigates anywhere: only its own document loads.
        onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url.startsWith("data:")}
        setSupportMultipleWindows={false}
        onMessage={(e) => {
          const m = readSurfaceMessage(e.nativeEvent.data, nonce, surface.id);
          if (m && "refused" in m) return answer({ id: m.refused, ok: false, error: "not allowed" });
          if (m && "call" in m) {
            const { id, method, params } = m.call;
            if (inFlight.current >= CALLS_MAX) return answer({ id, ok: false, error: "too many calls at once" });
            inFlight.current++;
            // The core checks the params against the method's schema; the surface id is this view's own.
            void client
              .call(method, params as Params<typeof method>)
              .then(
                (value) => answer({ id, ok: true, value }),
                (err: unknown) => answer({ id, ok: false, error: err instanceof Error ? err.message : "call failed" }),
              )
              .finally(() => {
                inFlight.current--;
              });
            return;
          }
          if (!m || Date.now() - last.current < PROMPT_GAP_MS) return;
          last.current = Date.now();
          void client.call("surfaces.prompt", { surface: surface.id, text: m.prompt }).catch(() => {});
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
  loading: { padding: 40, alignItems: "center" },
}));
