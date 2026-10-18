import { act, renderHook } from "@testing-library/react-native";
import Constants from "expo-constants";
import { PermissionStatus } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import { AppState, type AppStateStatus, Linking } from "react-native";
import { useNotifications } from "../src/hooks/useNotifications";
import { t } from "../src/i18n";
import {
  notificationPreview,
  notificationStatus,
  onNotificationStatus,
  onScreen,
  refreshNotifications,
  setViewingThread,
  showLiveNotice,
} from "../src/notifications";
import { setSoundPrefs } from "../src/sounds";
import { credentials, deferred, transport } from "./transport.test-support";

jest.mock("expo-notifications", () => ({
  ...jest.requireActual("expo-notifications"),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getPresentedNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

const granted: Notifications.NotificationPermissionsStatus = {
  status: PermissionStatus.GRANTED,
  granted: true,
  canAskAgain: true,
  expires: "never",
};
const denied: Notifications.NotificationPermissionsStatus = {
  status: PermissionStatus.DENIED,
  granted: false,
  canAskAgain: false,
  expires: "never",
};
const off: Notifications.NotificationPermissionsStatus = { ...denied, canAskAgain: true };
const originalEas = Object.getOwnPropertyDescriptor(Constants, "easConfig");
const originalState = AppState.currentState;
let net: ReturnType<typeof transport>;

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  net = transport();
  net.responses["devices.list"] = { devices: [] };
  jest.spyOn(Notifications, "getPermissionsAsync").mockResolvedValue(granted);
  jest.spyOn(Notifications, "requestPermissionsAsync").mockResolvedValue(granted);
  jest.spyOn(Notifications, "getPresentedNotificationsAsync").mockResolvedValue([]);
  jest.spyOn(Notifications, "dismissNotificationAsync").mockResolvedValue(undefined);
  jest.spyOn(Notifications, "scheduleNotificationAsync").mockResolvedValue("scheduled");
  Object.defineProperty(Constants, "easConfig", { configurable: true, value: undefined });
  AppState.currentState = "active";
  setViewingThread(undefined);
  setSoundPrefs({ notice: "all" });
  await refreshNotifications();
});
afterEach(() => {
  net.restore();
  AppState.currentState = originalState;
  if (originalEas) Object.defineProperty(Constants, "easConfig", originalEas);
  else Reflect.deleteProperty(Constants, "easConfig");
  jest.useRealTimers();
});

test("permission reads never spend the system prompt; only an explicit enable tap may ask", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(off);
  await refreshNotifications();
  expect(notificationStatus()).toEqual({ state: "off" });
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await refreshNotifications(undefined, true);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(notificationStatus()).toEqual({ state: "local" });
});

test("status subscriptions receive changes and detach independently", async () => {
  const first = jest.fn();
  const second = jest.fn();
  const stop = onNotificationStatus(first);
  const stopSecond = onNotificationStatus(second);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(denied);
  await refreshNotifications();
  expect(first).toHaveBeenLastCalledWith({ state: "denied" });
  stop();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted);
  await refreshNotifications();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenLastCalledWith({ state: "local" });
  stopSecond();
});

test("permission failures publish a useful error without registering push", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockRejectedValue(new Error("Native permission failed"));
  await refreshNotifications(credentials);
  expect(notificationStatus()).toEqual({ state: "error", detail: "Native permission failed" });
  expect(net.calls).toEqual([]);
});

test("a build without Expo push distinguishes local notifications from this device's ntfy registration", async () => {
  net.responses["devices.list"] = { devices: [{ id: "dev_other", push: "unifiedpush" }] };
  await refreshNotifications(credentials);
  expect(notificationStatus()).toEqual({ state: "local", localEnabled: true });
  net.responses["devices.list"] = { devices: [{ id: credentials.device, push: "unifiedpush" }] };
  await refreshNotifications(credentials);
  expect(notificationStatus()).toEqual({ state: "push", via: "ntfy" });
  expect(net.calls).toEqual([
    { method: "devices.list", params: {} },
    { method: "devices.list", params: {} },
  ]);
});

test("Expo push registers the token on the paired core and does not register it twice in one session", async () => {
  Object.defineProperty(Constants, "easConfig", { configurable: true, value: { projectId: "test-project" } });
  jest
    .spyOn(Notifications, "getExpoPushTokenAsync")
    .mockResolvedValue({ type: "expo", data: "ExpoPushToken[test-token]" });
  net.responses["devices.set_push"] = { ok: true };
  await refreshNotifications(credentials);
  expect(notificationStatus()).toEqual({ state: "push", via: "expo" });
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "test-project" });
  expect(net.calls).toEqual([
    { method: "devices.set_push", params: { push: { kind: "expo", token: "ExpoPushToken[test-token]" } } },
  ]);
  await refreshNotifications(credentials);
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
  expect(net.calls).toHaveLength(1);
});

test("a stalled push token times out, retains local delivery and releases the registration attempt", async () => {
  Object.defineProperty(Constants, "easConfig", { configurable: true, value: { projectId: "test-project" } });
  const token = deferred<Notifications.ExpoPushToken>();
  jest.spyOn(Notifications, "getExpoPushTokenAsync").mockReturnValue(token.promise);
  let refreshing: Promise<void> | undefined;
  await act(async () => {
    refreshing = refreshNotifications(credentials);
  });
  expect(notificationStatus()).toEqual({ state: "registering", localEnabled: true });
  await act(() => jest.advanceTimersByTimeAsync(20000));
  await refreshing;
  expect(notificationStatus()).toEqual({ state: "error", localEnabled: true, detail: t("pushSlow") });
  expect(net.calls).toEqual([]);
  await refreshNotifications();
  expect(notificationStatus()).toEqual({ state: "local" });
});

test("opening a foreground chat dismisses its existing alerts and suppresses duplicate OS notices", async () => {
  const presented = (identifier: string, thread: string): Notifications.Notification => ({
    date: 1,
    request: {
      identifier,
      trigger: null,
      content: {
        title: "Chat",
        subtitle: null,
        body: "Message",
        sound: null,
        categoryIdentifier: null,
        data: { thread_id: thread },
      },
    },
  });
  jest
    .mocked(Notifications.getPresentedNotificationsAsync)
    .mockResolvedValue([presented("shown_one", "thr_viewed"), presented("shown_other", "thr_other")]);
  await act(async () => {
    setViewingThread("thr_viewed");
  });
  expect(onScreen("thr_viewed", "active")).toBe(true);
  expect(onScreen("thr_viewed", "background")).toBe(false);
  expect(onScreen("thr_other", "active")).toBe(false);
  expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("shown_one");
  expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith("shown_other");
  await showLiveNotice(
    { id: "viewed", title: "Chat", body: "Already visible", thread_id: "thr_viewed" },
    credentials.device,
  );
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("concurrent live events schedule one OS notification, and a later read event dismisses it", async () => {
  const notice = { id: "deduplicated", kind: "task", title: "Task changed", body: "Review", thread_id: "thr_task" };
  await Promise.all([showLiveNotice(notice, credentials.device), showLiveNotice(notice, credentials.device)]);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      identifier: "apx-deduplicated",
      content: expect.objectContaining({ title: notice.title, body: notice.body }),
    }),
  );
  await showLiveNotice({ ...notice, read_at: "2026-10-18T10:00:00Z" }, credentials.device);
  expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("apx-deduplicated");
});

test("an OS scheduling failure may retry the same notice instead of marking an undelivered event as delivered", async () => {
  const schedule = jest
    .mocked(Notifications.scheduleNotificationAsync)
    .mockRejectedValueOnce(new Error("OS unavailable"));
  const notice = { id: "retry-scheduling", title: "Task", body: "Review" };
  await expect(showLiveNotice(notice, credentials.device)).rejects.toThrow("OS unavailable");
  await showLiveNotice(notice, credentials.device);
  expect(schedule).toHaveBeenCalledTimes(2);
});

test("denied notification permission schedules nothing and a silent preview has no sound", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(denied);
  await showLiveNotice({ id: "permission-denied", title: "Task", body: "Review" }, credentials.device);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  setSoundPrefs({ notice: "off" });
  await notificationPreview();
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ title: "APX", sound: false, data: { source: "apx-live", sound: false } }),
    }),
  );
});

test("the notification hook opens system settings for denied permission and refreshes only on foreground activation", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(denied);
  const open = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
  const remove = jest.fn();
  let change: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    change = listener;
    return { remove };
  });
  const hook = await renderHook(() => useNotifications());
  expect(hook.result.current.status).toEqual({ state: "denied" });
  await act(() => hook.result.current.enable());
  expect(open).toHaveBeenCalledTimes(1);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  const count = jest.mocked(Notifications.getPermissionsAsync).mock.calls.length;
  await act(async () => {
    change?.("background");
  });
  expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(count);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted);
  await act(async () => {
    change?.("active");
  });
  expect(hook.result.current.status).toEqual({ state: "local" });
  await hook.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
