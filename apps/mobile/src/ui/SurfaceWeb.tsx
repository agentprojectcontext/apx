import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { Params } from "../../../../packages/protocol/src/index.ts";
import { t } from "../i18n";
import type { ApxClient, Surface } from "../protocol";
import { pageDoc, readSurfaceMessage, surfaceDoc, surfaceResult } from "../surfaceDoc";
import { IconButton } from "./kit";
import { makeStyles, useTheme } from "./theme";
import { palettes } from "./tokens";

/** Least time between two prompts from one widget, as in the panel. */
const PROMPT_GAP_MS = 1500;
/** Bridge calls (store, db) one page may have waiting at once, as in the panel. */
const CALLS_MAX = 16;
/** A widget in a chat grows with its content up to this; past it, it scrolls inside or opens full screen. */
const FIT_MAX = 560;
const FIT_MIN = 80;

/**
 * A widget, app or web page an agent made, live: drawn in the app's scheme with its bridge (its own store and
 * database, prompts after a touch), or a page as a browser shows it. `fit` makes it as tall as its content (a chat).
 */
export function SurfaceWeb({ surface, client, fit }: { surface: Surface; client: ApxClient; fit?: boolean }) {
  const theme = useTheme();
  const nonce = useMemo(() => Math.random().toString(36).slice(2) + Date.now().toString(36), []);
  const html = useMemo(
    () =>
      surface.page
        ? pageDoc(surface.html)
        : surfaceDoc(surface.html, { mode: theme.scheme, nonce, layout: surface.app ? "app" : "widget" }),
    [surface.html, surface.app, surface.page, nonce, theme.scheme],
  );
  const [height, setHeight] = useState(240);
  const last = useRef(0);
  const view = useRef<WebView>(null);
  const inFlight = useRef(0);
  const answer = (r: Parameters<typeof surfaceResult>[1]) => view.current?.injectJavaScript(surfaceResult(nonce, r));
  return (
    <WebView
      ref={view}
      testID="surface-web"
      style={[
        { backgroundColor: surface.page ? palettes.light.surface : theme.bg },
        fit ? { height, flex: 0 } : { flex: 1 },
      ]}
      originWhitelist={["about:blank"]}
      source={{ html }}
      javaScriptEnabled
      nestedScrollEnabled
      // A widget never navigates anywhere: only its own document loads.
      onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url.startsWith("data:")}
      setSupportMultipleWindows={false}
      onMessage={(e) => {
        const m = readSurfaceMessage(e.nativeEvent.data, nonce, surface.id);
        if (m && "size" in m) {
          if (fit) setHeight(Math.min(FIT_MAX, Math.max(FIT_MIN, m.size)));
          return;
        }
        // A web page has no bridge: nothing it posts reaches the core.
        if (surface.page) return;
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
  );
}

/** While a widget is open full screen the phone may turn, so a wide one shows larger; the app is upright again after. */
export function useTurnable(on: boolean) {
  useEffect(() => {
    if (!on) return;
    void ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [on]);
}

/** Turns the screen sideways or back upright, for a phone whose auto-rotate is off. */
export async function turnScreen() {
  const now = await ScreenOrientation.getOrientationAsync();
  const upright =
    now === ScreenOrientation.Orientation.PORTRAIT_UP || now === ScreenOrientation.Orientation.PORTRAIT_DOWN;
  await ScreenOrientation.lockAsync(
    upright ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
  );
}

/** A widget over the whole screen, with a button to turn it sideways and one to close it. */
export function SurfaceFull({
  surface,
  client,
  onClose,
}: {
  surface: Surface;
  client: ApxClient;
  onClose: () => void;
}) {
  const s = useStyles();
  // Edge to edge, so the bars and a turned phone's camera cutout never cover the widget or its buttons.
  const insets = useSafeAreaInsets();
  useTurnable(true);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View
        style={[
          s.full,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <View style={s.head}>
          <Text numberOfLines={1} style={s.title}>
            {surface.title}
          </Text>
          <IconButton icon="RotateCcw" label={t("widgetTurn")} onPress={() => void turnScreen().catch(() => {})} />
          <IconButton icon="X" label={t("close")} onPress={onClose} />
        </View>
        <SurfaceWeb surface={surface} client={client} />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((theme) => ({
  full: { flex: 1, backgroundColor: theme.bg },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  title: { flex: 1, color: theme.fg, fontSize: 16, fontWeight: "600" },
}));
