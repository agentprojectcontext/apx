import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import type { Creds } from "../creds";
import { configureNotifications, type NotificationStatus } from "../notifications";

export function useNotifications(creds?: Creds) {
  const [status, setStatus] = useState<NotificationStatus>({ state: "checking" });
  const generation = useRef(0);
  const refresh = useCallback(
    async (request = false) => {
      const current = ++generation.current;
      const result = await configureNotifications(creds, request);
      if (generation.current === current) setStatus(result);
    },
    [creds],
  );
  // Opening a screen only reads the permission; the system prompt waits for the owner's tap (`enable`).
  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      generation.current++;
      subscription.remove();
    };
  }, [refresh]);
  const enable = async () => {
    if (status.state === "denied") await Linking.openSettings();
    else await refresh(true);
  };
  return { status, enable };
}
