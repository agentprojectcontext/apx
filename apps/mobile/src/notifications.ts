import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { APP_CLIENT } from "./appInfo";
import type { Creds } from "./creds";
import { t } from "./i18n";
import { soundsFor } from "./noticeSound";
import { permissionState, shouldAsk } from "./notificationPermission";
import { ApxClient } from "./protocol";
import { soundPrefs } from "./sounds";

/** Android fixes a channel's sound when it is made: one with APX's sound, one quiet, picked per notice. */
const SOUND_CHANNEL = "apx-sound";
const QUIET_CHANNEL = "apx-quiet";
const SOUND_FILE = "message.wav";

export type NotificationStatus = {
  /** `off`: not turned on yet, the owner can still be asked; `denied`: only the system settings can turn it on. */
  state: "checking" | "off" | "denied" | "local" | "push" | "error";
  /** With `push`: Expo's service, or the ntfy app holding the address the owner gave this phone in the panel. */
  via?: "expo" | "ntfy";
  detail?: string;
  localEnabled?: boolean;
};
const delivered = new Set<string>();
let remoteDevice: string | undefined;
/** The chat on screen: news about it is already in front of the owner. */
let viewing: string | undefined;

/** The open chat changed; its notifications in the tray go away, the owner is reading it. */
export function setViewingThread(threadId: string | undefined): void {
  viewing = threadId;
  if (threadId) void dismissThread(threadId).catch(() => undefined);
}

/** Whether an alert about this chat would only repeat what is on screen. */
export function onScreen(threadId: string | undefined, appState: string = AppState.currentState): boolean {
  return Boolean(threadId && threadId === viewing && appState === "active");
}

async function dismissThread(threadId: string) {
  const shown = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(
    shown
      .filter((item) => item.request.content.data?.thread_id === threadId)
      .map((item) => Notifications.dismissNotificationAsync(item.request.identifier)),
  );
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    const local = data?.source === "apx-live";
    // In the app, a remote push repeats the live notice; about the chat on screen, neither sounds.
    const thread = typeof data?.thread_id === "string" ? data.thread_id : undefined;
    const show = !(remoteDevice && AppState.currentState === "active" && !local) && !onScreen(thread);
    const sound = show && data?.sound !== false;
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: sound, shouldSetBadge: show };
  },
});

/** Android needs a channel before requesting permission or a device push token. `request`: the owner tapped to ask. */
async function permission(request: boolean) {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "APX",
      // No `sound`: a name here means a bundled file; leaving it out keeps the system's notification sound.
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: "#3ec98b",
    });
    await Notifications.setNotificationChannelAsync(SOUND_CHANNEL, {
      name: "APX",
      sound: SOUND_FILE,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: "#3ec98b",
    });
    await Notifications.setNotificationChannelAsync(QUIET_CHANNEL, {
      name: t("quietNotices"),
      sound: null,
      enableVibrate: false,
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#3ec98b",
    });
  }
  const read = (result: Notifications.NotificationPermissionsStatus) =>
    permissionState({
      granted: result.granted,
      canAskAgain: result.canAskAgain,
      provisional: result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
    });
  const state = read(await Notifications.getPermissionsAsync());
  return shouldAsk(state, request) ? read(await Notifications.requestPermissionsAsync()) : state;
}

/** Never report remote delivery as active when only local notification permission is granted. */
export async function configureNotifications(creds?: Creds, request = false): Promise<NotificationStatus> {
  let localEnabled = false;
  try {
    const state = await permission(request);
    if (state !== "granted") return { state };
    localEnabled = true;
    const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (!creds) return { state: "local" };
    const client = new ApxClient({
      url: creds.url,
      token: creds.token,
      client: APP_CLIENT,
    });
    if (!projectId) return await viaNtfy(client, creds);
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await client.call("devices.set_push", { push: { kind: "expo", token: data } });
    remoteDevice = creds.device;
    return { state: "push", via: "expo" };
  } catch (error) {
    return { state: "error", localEnabled, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** A build without Expo push still reaches the owner when the panel gave this phone an ntfy address. */
async function viaNtfy(client: ApxClient, creds: Creds): Promise<NotificationStatus> {
  try {
    const { devices } = await client.call("devices.list", {});
    if (devices.find((device) => device.id === creds.device)?.push !== "unifiedpush") return { state: "local" };
  } catch {
    return { state: "local" };
  }
  remoteDevice = creds.device;
  return { state: "push", via: "ntfy" };
}

/**
 * Translate unread live notices to OS notifications, with sound: not about the chat on screen, and not while the app
 * is away on a device the core reaches by push (that push already sounds). A notice read elsewhere leaves the tray.
 */
export async function showLiveNotice(
  notice: { id: string; kind?: string; title: string; body: string; read_at?: string; thread_id?: string },
  device: string,
): Promise<void> {
  const key = `${device}:${notice.id}`;
  if (notice.read_at) {
    if (delivered.has(key)) await Notifications.dismissNotificationAsync(`apx-${notice.id}`);
    return;
  }
  if (delivered.has(key) || onScreen(notice.thread_id)) return;
  if (remoteDevice === device && AppState.currentState !== "active") return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
  if (delivered.has(key)) return;
  delivered.add(key);
  if (delivered.size > 500) delivered.delete(delivered.values().next().value ?? "");
  // Which notices sound is the owner's choice on this phone (Settings › Sounds); the rest arrive quiet.
  const sound = soundsFor(notice.kind, soundPrefs().notice);
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `apx-${notice.id}`,
      content: {
        title: notice.title,
        body: notice.body,
        sound: sound ? SOUND_FILE : false,
        data: { thread_id: notice.thread_id, source: "apx-live", sound },
      },
      trigger: Platform.OS === "android" ? { channelId: sound ? SOUND_CHANNEL : QUIET_CHANNEL } : null,
    });
  } catch (error) {
    delivered.delete(key);
    throw error;
  }
}

export function notificationPreview() {
  const sound = soundPrefs().notice !== "off";
  return Notifications.scheduleNotificationAsync({
    content: {
      title: "APX",
      body: t("notificationPreview"),
      sound: sound ? SOUND_FILE : false,
      data: { source: "apx-live", sound },
    },
    trigger: Platform.OS === "android" ? { channelId: sound ? SOUND_CHANNEL : QUIET_CHANNEL } : null,
  });
}
