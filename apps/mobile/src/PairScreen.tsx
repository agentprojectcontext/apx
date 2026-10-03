import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Button, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { type Creds, saveCreds } from "./creds";
import { t } from "./i18n";
import { firstReachable, parsePairingLink } from "./pairing";
import { ApxClient } from "./protocol";

const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other";

/** Scan the panel's QR (or type its address and code): the core gives this phone a key of its own. */
export function PairScreen({ link, onPaired }: { link: string | undefined; onPaired: (c: Creds) => void }) {
  const [permission, ask] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const once = useRef(false);

  const pair = async (urls: string[], typed: string) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const reachable = await firstReachable(urls);
      if (!reachable) return setError(t("unreachable"));
      const client = new ApxClient({ url: reachable, client: { name: "apx-mobile", version: "0.0.0" } });
      const r = await client.call("devices.pair", { code: typed, name: deviceName(), platform });
      const creds = { url: reachable, token: r.token, device: r.device.id };
      await saveCreds(creds);
      onPaired(creds);
    } catch (e) {
      setError(t("failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
      once.current = false;
    }
  };

  // An apx://pair link opened the app: pair with it at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per link
  useEffect(() => {
    const p = link ? parsePairingLink(link) : undefined;
    if (p) void pair(p.urls, p.code);
  }, [link]);

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t("pairTitle")}</Text>
      <Text style={styles.lead}>{t("pairLead")}</Text>
      {scanning && permission?.granted ? (
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            const p = parsePairingLink(data);
            if (!p || once.current) return;
            once.current = true;
            setScanning(false);
            void pair(p.urls, p.code);
          }}
        />
      ) : (
        <Button
          title={permission && !permission.granted && !permission.canAskAgain ? t("noCamera") : t("scan")}
          onPress={() => void (permission?.granted ? setScanning(true) : ask().then((p) => setScanning(p.granted)))}
        />
      )}
      <Text style={styles.or}>{t("orType")}</Text>
      <TextInput
        style={styles.input}
        placeholder={t("address")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={url}
        onChangeText={setUrl}
      />
      <TextInput
        style={styles.input}
        placeholder={t("code")}
        autoCapitalize="characters"
        autoCorrect={false}
        value={code}
        onChangeText={setCode}
      />
      <Button
        title={busy ? t("pairing") : t("pair")}
        disabled={busy || !url.trim() || code.trim().length < 6}
        onPress={() => void pair([url.trim()], code.trim())}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

/** How the panel lists this phone. */
function deviceName(): string {
  return Platform.OS === "ios" ? "iPhone" : Platform.OS === "android" ? "Android" : "Phone";
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: "600" },
  lead: { fontSize: 15, opacity: 0.7 },
  camera: { height: 280, borderRadius: 12, overflow: "hidden" },
  or: { marginTop: 12, fontSize: 13, opacity: 0.6 },
  input: { borderWidth: 1, borderColor: "#d6d4ce", borderRadius: 8, padding: 10, fontSize: 15 },
  error: { color: "#d23c3c" },
});
