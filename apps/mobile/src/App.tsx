import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { type Creds, clearCreds, loadCreds } from "./creds";
import { PairScreen } from "./PairScreen";
import { type PhotoAsk, PhotoModal } from "./PhotoModal";
import { parsePairingLink } from "./pairing";
import { startPhoneNode } from "./phone";
import { ApxClient, ApxError } from "./protocol";
import { theme } from "./ui/theme";
import { WorkspaceScreen } from "./WorkspaceScreen";

/** Paired: the super-agent's chat. Not yet: the pairing screen (a QR, an apx://pair link, or typed by hand). */
export function App() {
  const [creds, setCreds] = useState<Creds | null>();
  const [link, setLink] = useState<string>();
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
  const unpair = useCallback(() => {
    void clearCreds();
    setCreds(null);
  }, []);
  useEffect(() => {
    void loadCreds().then(async (creds) => {
      if (!creds) {
        setCreds(null);
        return;
      }
      try {
        await new ApxClient({
          url: creds.url,
          token: creds.token,
          client: { name: "apx-mobile", version: "2.0.2" },
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
    // Opened from an apx://pair link (the QR scanned with the phone's own camera).
    void Linking.getInitialURL().then((u) => u && parsePairingLink(u) && setLink(u));
    const sub = Linking.addEventListener("url", ({ url }) => parsePairingLink(url) && setLink(url));
    return () => sub.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar style="light" />
        <PhotoModal ask={photo} />
        {creds === undefined ? (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        ) : creds && !link ? (
          <WorkspaceScreen creds={creds} onUnpair={unpair} />
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
    </SafeAreaProvider>
  );
}
