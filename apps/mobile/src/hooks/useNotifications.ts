import { useEffect, useState } from "react";
import { AppState, Linking } from "react-native";
import type { Creds } from "../creds";
import { notificationStatus, onNotificationStatus, refreshNotifications } from "../notifications";

/** The app's one notification status; coming back to the app reads the permission again (it may have changed). */
export function useNotifications(creds?: Creds) {
  const [status, setStatus] = useState(notificationStatus);
  useEffect(() => {
    const off = onNotificationStatus(setStatus);
    setStatus(notificationStatus());
    // Opening a screen only reads the permission; the system prompt waits for the owner's tap (`enable`).
    void refreshNotifications(creds);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshNotifications(creds);
    });
    return () => {
      off();
      subscription.remove();
    };
  }, [creds]);
  const enable = async () => {
    if (status.state === "denied") await Linking.openSettings();
    else await refreshNotifications(creds, true);
  };
  return { status, enable };
}
