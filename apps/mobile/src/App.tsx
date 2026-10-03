import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ChatScreen } from "./ChatScreen";
import { type Creds, clearCreds, loadCreds } from "./creds";
import { PairScreen } from "./PairScreen";
import { parsePairingLink } from "./pairing";

/** Paired: the super-agent's chat. Not yet: the pairing screen (a QR, an apx://pair link, or typed by hand). */
export function App() {
  const [creds, setCreds] = useState<Creds | null>();
  const [link, setLink] = useState<string>();
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
        {creds === undefined ? (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        ) : creds && !link ? (
          <ChatScreen
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
