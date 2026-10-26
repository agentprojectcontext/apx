// Media from the core as files on the phone: fetched once through media.get into the cache, then shown, played,
// shared or saved from there.
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Asset, type GranularPermission, getPermissionsAsync, requestPermissionsAsync } from "expo-media-library";
import * as Sharing from "expo-sharing";
import { Alert, Linking } from "react-native";
import { t } from "../i18n";
import type { ApxClient } from "../protocol";
import { flash } from "../ui/Flash";
import { fileName, galleryFileName, type MediaItem } from "./media";

const loading = new Map<string, Promise<string>>();

const folder = () => {
  const dir = new Directory(Paths.cache, "media");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
};

/** A file:// uri for the item; the same promise for every view that shows it, retried after a failure. */
export function mediaFile(client: ApxClient, item: MediaItem): Promise<string> {
  const id = item.media_id ?? item.url ?? item.key;
  let p = loading.get(id);
  if (p) return p;
  p = (async () => {
    // One folder per media keeps the file's own name, which a share or the gallery then shows.
    const dir = new Directory(folder(), (item.media_id ?? `web-${hash(id)}`).replace(/[^\w-]/g, ""));
    if (!dir.exists) dir.create();
    const file = new File(dir, fileName(item));
    if (file.exists && (file.size ?? 0) > 0) return file.uri;
    if (item.media_id) {
      const { data } = await client.call("media.get", { id: item.media_id });
      if (!file.exists) file.create();
      file.write(data, { encoding: "base64" });
      return file.uri;
    }
    if (item.url && /^https?:/i.test(item.url)) return (await File.downloadFileAsync(item.url, file)).uri;
    throw new Error(t("mediaUnavailable"));
  })();
  p.catch(() => loading.delete(id));
  loading.set(id, p);
  return p;
}

function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const failed = (title: string) => (error: unknown) =>
  Alert.alert(title, error instanceof Error ? error.message : String(error));

/** The system share sheet with the file itself: send it, open it in another app or keep it in Files. */
export async function shareMedia(client: ApxClient, item: MediaItem): Promise<void> {
  try {
    const uri = await mediaFile(client, item);
    await Sharing.shareAsync(uri, { mimeType: item.mime, dialogTitle: item.name });
  } catch (error) {
    failed(t("couldNotShare"))(error);
  }
}

/** A copy in the phone's gallery (pictures and videos). */
export async function saveMedia(client: ApxClient, item: MediaItem): Promise<void> {
  try {
    const name = galleryFileName(item);
    if (!name) {
      await shareMedia(client, item);
      return;
    }
    const kinds: GranularPermission[] = [item.kind === "video" ? "video" : "photo"];
    // Asking again when already allowed still starts the system's permission screen, which pauses the app.
    const allowed =
      (await getPermissionsAsync(true, kinds)).granted || (await requestPermissionsAsync(true, kinds)).granted;
    if (!allowed) {
      Alert.alert(t("galleryDenied"), t("galleryDeniedBody"));
      return;
    }
    const source = new File(await mediaFile(client, item));
    const dir = new Directory(Paths.cache, `gallery-${randomUUID()}`);
    dir.create();
    try {
      const copy = new File(dir, name);
      source.copy(copy);
      await Asset.create(copy.uri);
      flash(t("savedToGallery"), "Download");
    } finally {
      dir.delete();
    }
  } catch (error) {
    failed(t("couldNotSave"))(error);
  }
}

/** A picture from the web opens where it lives. */
export function openOnWeb(item: MediaItem): void {
  if (item.url && /^https?:/i.test(item.url)) void Linking.openURL(item.url);
}
