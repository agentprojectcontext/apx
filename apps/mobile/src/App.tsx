import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ChatScreen } from "./ChatScreen";
import { type Creds, clearCreds, loadCreds } from "./creds";
import { PairScreen } from "./PairScreen";
import { type PhotoAsk, PhotoModal } from "./PhotoModal";
import { parsePairingLink } from "./pairing";
import { registerPush, startPhoneNode } from "./phone";
import { SurfacesScreen } from "./SurfacesScreen";

/** Paired: the super-agent's chat. Not yet: the pairing screen (a QR, an apx://pair link, or typed by hand). */
export function App() {
  const [creds, setCreds] = useState<Creds | null>();
  const [link, setLink] = useState<string>();
  const [photo, setPhoto] = useState<PhotoAsk>();
  const [apps, setApps] = useState(false);
  // Paired: the phone lends its location and camera to the core, and registers for push.
  useEffect(() => {
    if (!creds) return;
    void registerPush(creds);
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
  useEffect(() => {
    void loadCreds().then((c) => setCreds(c ?? null));
    // Opened from an apx://pair link (the QR scanned with the phone's own camera).
    void Linking.getInitialURL().then((u) => u && parsePairingLink(u) && setLink(u));
    const sub = Linking.addEventListener("url", ({ url }) => parsePairingLink(url) && setLink(url));
    return () => sub.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <StatusBar style="auto" />
        <PhotoModal ask={photo} />
        {creds === undefined ? (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        ) : creds && !link && apps ? (
          <SurfacesScreen creds={creds} onBack={() => setApps(false)} />
        ) : creds && !link ? (
          <ChatScreen
            onApps={() => setApps(true)}
            creds={creds}
            onUnpair={() => {
              void clearCreds();
              setCreds(null);
            }}
          />
        ) : (
          <PairScreen
            link={link}
            onPaired={(c) => {
              setLink(undefined);
              setCreds(c);
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
