import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import type { Creds } from "./creds";
import { t } from "./i18n";
import { ApxClient } from "./protocol";

export type NotificationStatus = {
  state: "checking" | "denied" | "local" | "push" | "error";
  detail?: string;
  localEnabled?: boolean;
};
const delivered = new Set<string>();
let remoteDevice: string | undefined;

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const local = notification.request.content.data?.source === "apx-live";
    const show = !(remoteDevice && AppState.currentState === "active" && !local);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: show };
  },
});

/** Android needs a channel before requesting permission or a device push token. */
async function permission(request: boolean) {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "APX",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 150, 250],
      lightColor: "#3ec98b",
    });
  }
  let result = await Notifications.getPermissionsAsync();
  if (!result.granted && result.canAskAgain && request) result = await Notifications.requestPermissionsAsync();
  return result.granted || result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** Never report remote delivery as active when only local notification permission is granted. */
export async function configureNotifications(creds?: Creds, request = true): Promise<NotificationStatus> {
  let localEnabled = false;
  try {
    if (!(await permission(request))) return { state: "denied" };
    localEnabled = true;
    const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (!creds || !projectId) return { state: "local" };
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    const client = new ApxClient({
      url: creds.url,
      token: creds.token,
      client: { name: "apx-mobile", version: "2.0.2" },
    });
    await client.call("devices.set_push", { push: { kind: "expo", token: data } });
    remoteDevice = creds.device;
    return { state: "push" };
  } catch (error) {
    return { state: "error", localEnabled, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Translate unread live notices to OS notifications; remote push already covers a registered device. */
export async function showLiveNotice(
  notice: { id: string; title: string; body: string; read_at?: string; thread_id?: string },
  device: string,
): Promise<void> {
  const key = `${device}:${notice.id}`;
  if (notice.read_at || delivered.has(key) || (remoteDevice === device && AppState.currentState !== "active")) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
  if (delivered.has(key)) return;
  delivered.add(key);
  if (delivered.size > 500) delivered.delete(delivered.values().next().value ?? "");
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `apx-${notice.id}`,
      content: {
        title: notice.title,
        body: notice.body,
        sound: "default",
        data: { thread_id: notice.thread_id, source: "apx-live" },
      },
      trigger: Platform.OS === "android" ? { channelId: "default" } : null,
    });
  } catch (error) {
    delivered.delete(key);
    throw error;
  }
}

export function notificationPreview() {
  return Notifications.scheduleNotificationAsync({
    content: { title: "APX", body: t("notificationPreview"), sound: "default", data: { source: "apx-live" } },
    trigger: Platform.OS === "android" ? { channelId: "default" } : null,
  });
}
