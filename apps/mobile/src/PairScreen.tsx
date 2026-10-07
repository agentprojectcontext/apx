import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Creds } from "./creds";
import { usePairing } from "./hooks/usePairing";
import { t } from "./i18n";
import { parsePairingLink } from "./pairing";
import { Icon } from "./ui/Icon";
import { theme } from "./ui/theme";

/** Native counterpart of the web's pairing gate, with QR and manual network address entry. */
export function PairScreen({ link, onPaired }: { link: string | undefined; onPaired: (creds: Creds) => void }) {
  const [permission, askCamera] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const { busy, error, pair } = usePairing(link, onPaired);
  const scan = async () => {
    if (permission?.granted) setScanning(true);
    else if (permission && !permission.canAskAgain) await Linking.openSettings();
    else setScanning((await askCamera()).granted);
  };
  const submit = () => {
    const parsed = parsePairingLink(url);
    void pair(parsed?.urls ?? [url.trim()], parsed?.code ?? code);
  };
  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.brand}>
        <Image source={require("../assets/logo.png")} style={s.logo} />
        <Text style={s.brandName}>APX</Text>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.kickerRow}>
          <View style={s.kickerLine} />
          <Text style={s.kicker}>{t("pairKicker")}</Text>
        </View>
        <Text style={s.title}>
          {t("pairHeading")}
          {"\n"}
          <Text style={s.green}>{t("pairHeadingEnd")}</Text>
        </Text>
        <Text style={s.lead}>{t("pairHelp")}</Text>
        {scanning && permission?.granted ? (
          <View style={s.scanBox}>
            <CameraView
              style={s.camera}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                const parsed = parsePairingLink(data);
                if (!parsed || busy) return;
                setScanning(false);
                void pair(parsed.urls, parsed.code);
              }}
            />
            <Pressable onPress={() => setScanning(false)} style={s.secondary}>
              <Text style={s.secondaryText}>{t("stopScanning")}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void scan()} style={s.secondary}>
            <Icon name="QrCode" color={theme.fg} size={19} />
            <Text style={s.secondaryText}>{t("scan")}</Text>
          </Pressable>
        )}
        <View style={s.divider}>
          <View style={s.line} />
          <Text style={s.or}>{t("orType")}</Text>
          <View style={s.line} />
        </View>
        <Text style={s.label}>{t("serverAddress")}</Text>
        <View style={s.field}>
          <Icon name="Link" size={17} />
          <TextInput
            accessibilityLabel={t("serverAddress")}
            editable={!busy}
            style={s.input}
            placeholder="http://…:7440"
            placeholderTextColor={theme.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={url}
            onChangeText={setUrl}
          />
        </View>
        <Text style={s.label}>{t("pairingCode")}</Text>
        <View style={[s.field, Boolean(error) && s.invalid]}>
          <Icon name="KeyRound" size={17} />
          <TextInput
            accessibilityLabel={t("pairingCode")}
            editable={!busy}
            style={[s.input, s.code]}
            placeholder="ABCD2345"
            placeholderTextColor={theme.subtle}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={16}
            textContentType="oneTimeCode"
            value={code}
            onChangeText={setCode}
            onSubmitEditing={submit}
          />
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !url.trim() || (code.trim().length < 6 && !parsePairingLink(url))}
          onPress={submit}
          style={[s.primary, (busy || !url.trim() || (code.trim().length < 6 && !parsePairingLink(url))) && s.disabled]}
        >
          {busy ? (
            <ActivityIndicator color={theme.accentFg} />
          ) : (
            <Icon name="ArrowUp" size={18} color={theme.accentFg} />
          )}
          <Text style={s.primaryText}>{t(busy ? "pairing" : "pair")}</Text>
        </Pressable>
      </ScrollView>
      <Text style={s.version}>APX v{Constants.expoConfig?.version ?? "2.0.2"}</Text>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  brand: { height: 60, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  logo: { width: 28, height: 28 },
  brandName: { color: theme.fg, fontSize: 17, fontWeight: "600" },
  content: {
    padding: 24,
    paddingTop: 28,
    flexGrow: 1,
    justifyContent: "center",
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  kickerLine: { width: 24, height: 1, backgroundColor: theme.brandSoftFg },
  kicker: {
    color: theme.brandSoftFg,
    fontSize: 10,
    letterSpacing: 1.1,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  title: { fontSize: 36, lineHeight: 39, color: theme.fg, fontWeight: "600", letterSpacing: -1 },
  green: { color: theme.brandSoftFg },
  lead: { color: theme.muted, fontSize: 14, lineHeight: 22, marginTop: 16, marginBottom: 24 },
  secondary: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryText: { color: theme.fg, fontSize: 14, fontWeight: "500" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 22 },
  line: { height: 1, backgroundColor: theme.border, flex: 1 },
  or: { color: theme.subtle, fontSize: 11 },
  label: { color: theme.muted, fontSize: 12, marginBottom: 8, marginTop: 12 },
  field: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    backgroundColor: theme.surface,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: { flex: 1, fontSize: 14, color: theme.fg, paddingVertical: 12 },
  code: { letterSpacing: 2, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  invalid: { borderColor: theme.danger },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: theme.accent,
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 9,
  },
  primaryText: { fontSize: 14, color: theme.accentFg, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  error: { color: theme.danger, fontSize: 12, marginTop: 10, lineHeight: 18 },
  scanBox: { gap: 12 },
  camera: { height: 240, borderRadius: 18, overflow: "hidden" },
  version: { color: theme.subtle, fontSize: 11, paddingVertical: 12, textAlign: "center" },
});
