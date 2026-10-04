import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Button, Modal, StyleSheet, Text, View } from "react-native";
import { t } from "./i18n";

export type PhotoAsk = { reason: string | undefined; done: (p: { mime: string; data: string } | undefined) => void };

/** An agent asked for a picture: the owner sees why, frames it and takes it (or declines). */
export function PhotoModal({ ask }: { ask: PhotoAsk | undefined }) {
  const [permission, request] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  if (!ask) return null;
  const take = async () => {
    setBusy(true);
    try {
      const shot = await camera.current?.takePictureAsync({ base64: true, quality: 0.5, skipProcessing: true });
      ask.done(shot?.base64 ? { mime: "image/jpeg", data: shot.base64 } : undefined);
    } catch {
      ask.done(undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal animationType="slide" onRequestClose={() => ask.done(undefined)}>
      <View style={styles.box}>
        <Text style={styles.title}>{t("photoAsk")}</Text>
        {ask.reason && <Text style={styles.reason}>{ask.reason}</Text>}
        {permission?.granted ? (
          <CameraView ref={camera} style={styles.camera} />
        ) : (
          <Button title={t("allowCamera")} onPress={() => void request()} />
        )}
        <View style={styles.row}>
          <Button title={t("decline")} onPress={() => ask.done(undefined)} />
          <Button title={t("takePhoto")} disabled={busy || !permission?.granted} onPress={() => void take()} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 20, paddingTop: 60, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  reason: { fontSize: 15, opacity: 0.7 },
  camera: { flex: 1, borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 20 },
});
