import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { t } from "../i18n";
import type { ApxClient } from "../protocol";

/** A file on its way into the chat: uploading until it has the media id the message will carry. */
export type Attachment = {
  key: string;
  name: string;
  kind: "image" | "audio" | "file";
  /** Local file, for the thumbnail. */
  uri: string;
  mime: string;
  id?: string;
};

const LIMITS = { image: 5 * 1024 * 1024, audio: 10 * 1024 * 1024, file: 2 * 1024 * 1024 };
const kindOf = (mime: string): Attachment["kind"] =>
  mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "file";

/** Picks photos, takes pictures or picks files, and uploads each with media.upload as soon as it is chosen. */
export function useAttachments(client: ApxClient, threadId: string) {
  const [items, setItems] = useState<Attachment[]>([]);
  const upload = useCallback(
    async (uri: string, name: string, mime: string, size?: number): Promise<Attachment | undefined> => {
      const kind = kindOf(mime);
      if (size !== undefined && size > LIMITS[kind]) {
        Alert.alert(t("tooBig"), t("tooBigBody", { name, mb: LIMITS[kind] / 1024 / 1024 }));
        return undefined;
      }
      const key = `${Date.now()}:${name}`;
      setItems((list) => [...list, { key, name, kind, uri, mime }]);
      try {
        const data = await new File(uri).base64();
        const { media } = await client.call("media.upload", { name, mime, data, thread: threadId });
        const done = { key, name, kind, uri, mime, id: media.id };
        setItems((list) => list.map((item) => (item.key === key ? done : item)));
        return done;
      } catch (error) {
        setItems((list) => list.filter((item) => item.key !== key));
        Alert.alert(t("couldNotAttach"), error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
    [client, threadId],
  );
  const pickPhotos = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 8,
      quality: 0.7,
    });
    if (result.canceled) return;
    for (const asset of result.assets)
      void upload(asset.uri, asset.fileName ?? "photo.jpg", asset.mimeType ?? "image/jpeg", asset.fileSize);
  }, [upload]);
  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (result.canceled) return;
    const [asset] = result.assets;
    if (asset) void upload(asset.uri, asset.fileName ?? "photo.jpg", asset.mimeType ?? "image/jpeg", asset.fileSize);
  }, [upload]);
  const pickFiles = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    for (const asset of result.assets)
      void upload(asset.uri, asset.name, asset.mimeType ?? "application/octet-stream", asset.size);
  }, [upload]);
  const remove = useCallback((key: string) => setItems((list) => list.filter((item) => item.key !== key)), []);
  /** The uploaded ids for the message, and an empty tray for the next one. */
  const take = useCallback(() => {
    const ids = items.flatMap((item) => (item.id ? [item.id] : []));
    setItems([]);
    return ids;
  }, [items]);
  const uploading = items.some((item) => !item.id);
  return { items, uploading, upload, pickPhotos, takePhoto, pickFiles, remove, take };
}
