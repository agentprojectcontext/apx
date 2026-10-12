import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { loadAppearance } from "./appearance";
import { APP_CLIENT } from "./appInfo";
import { type Creds, clearCreds, loadCreds } from "./creds";
import { t } from "./i18n";
import { PairScreen } from "./PairScreen";
import { type PhotoAsk, PhotoModal } from "./PhotoModal";
import { fromPairedCore, parseOpenLink, parsePairingLink } from "./pairing";
import { startPhoneNode } from "./phone";
import { ApxClient, ApxError } from "./protocol";
import { type Scheme, ThemeProvider, themes, useSystemScheme } from "./ui/theme";
import { unpairDevice } from "./unpair";
import { WorkspaceScreen } from "./WorkspaceScreen";

/** Until every screen reads the theme through useTheme, the app stays dark. */
const PINNED: Scheme | undefined = "dark";

/** Paired: the super-agent's chat. Not yet: the pairing screen (a QR, an apx://pair link, or typed by hand). */
export function App() {
  const [creds, setCreds] = useState<Creds | null>();
  const [link, setLink] = useState<string>();
  /** The chat a scanned link asks to open. */
  const [focus, setFocus] = useState<string>();
  const [photo, setPhoto] = useState<PhotoAsk>();
  // Paired: the phone lends its location and camera to the core, and registers for push.
  useEffect(() => {
    if (!creds) return;
    return startPhoneNode(
      creds,
      (reason) =>
        new Promise((resolve) =>
          setPhoto({
            reason,
            done: (p) => {
              setPhoto(undefined);
              resolve(p);
            },
          }),
        ),
    );
  }, [creds]);
  const unpairing = useRef(false);
  const unpair = useCallback(() => {
    if (!creds || unpairing.current) return;
    unpairing.current = true;
    // The core revokes this phone's key first; out of reach, the phone forgets it anyway and says so.
    const client = new ApxClient({ url: creds.url, token: creds.token, client: APP_CLIENT, timeoutMs: 8000 });
    setCreds(undefined);
    void unpairDevice(() => client.call("devices.revoke", { id: creds.device }), clearCreds)
      .then((outcome) => {
        if (outcome === "local") Alert.alert(t("unpairedLocal"), t("unpairedLocalBody"));
      })
      .catch(() => undefined)
      .finally(() => {
        unpairing.current = false;
        setCreds(null);
      });
  }, [creds]);
  const system = useSystemScheme();
  useEffect(() => {
    void loadAppearance();
    void loadCreds().then(async (creds) => {
      if (!creds) {
        setCreds(null);
        return;
      }
      try {
        await new ApxClient({
          url: creds.url,
          token: creds.token,
          client: APP_CLIENT,
        }).call("system.ping", {});
      } catch (error) {
        if (error instanceof ApxError && error.code === "unauthorized") {
          await clearCreds();
          setCreds(null);
          return;
        }
      }
      setCreds(creds);
    });
    // Opened from an apx://pair link (the QR scanned with the phone's own camera), or an apx://open one (a notice).
    const take = (url: string | null) => {
      const open = url ? parseOpenLink(url) : undefined;
      if (open) {
        if (open.thread) setFocus(open.thread);
        return;
      }
      const parsed = url ? parsePairingLink(url) : undefined;
      if (!url || !parsed) return;
      setLink(url);
      if (parsed.thread) setFocus(parsed.thread);
    };
    void Linking.getInitialURL().then(take);
    const sub = Linking.addEventListener("url", ({ url }) => take(url));
    return () => sub.remove();
  }, []);
  // A link from the core this phone already talks to only opens its chat; pairing again would add a second device.
  const parsedLink = link ? parsePairingLink(link) : undefined;
  const known = Boolean(creds && parsedLink && fromPairedCore(parsedLink, creds.url));
  useEffect(() => {
    if (known) setLink(undefined);
  }, [known]);
  const focused = useCallback(() => setFocus(undefined), []);
  const paired = creds && (!link || known);
  // Pairing stays dark, as the panel's setup screens do; the rest follows the phone (or Settings).
  const scheme: Scheme = creds === null || (creds && !paired) ? "dark" : (PINNED ?? system);
  return (
    <SafeAreaProvider>
      <ThemeProvider scheme={scheme}>
        <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: themes[scheme].bg }}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <PhotoModal ask={photo} />
          {creds === undefined ? (
            <View style={{ flex: 1, justifyContent: "center" }}>
              <ActivityIndicator />
            </View>
          ) : paired ? (
            <WorkspaceScreen creds={creds} onUnpair={unpair} focus={focus} onFocused={focused} />
          ) : (
            <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
              <PairScreen
                link={link}
                onPaired={(c) => {
                  setLink(undefined);
                  setCreds(c);
                }}
              />
            </SafeAreaView>
          )}
        </SafeAreaView>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
