// The phone as a node (it lends its location and camera to the core) and its push registration. Both run while the
// app is paired; the node link reconnects on its own.
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import type { Creds } from "./creds";
import { handlePhoneRequest, PHONE_CAPS, type PhoneDeps } from "./phoneRequests";
import { ApxClient, type ApxSocket } from "./protocol";

const RETRY_MS = [2000, 5000, 15000, 30000];

/** Keeps a node link to the core; `photo` shows the camera to the owner. Returns a stop function. */
export function startPhoneNode(creds: Creds, photo: PhoneDeps["photo"]): () => void {
  const client = new ApxClient({ url: creds.url, token: creds.token, client: { name: "apx-phone", version: "0.0.0" } });
  let socket: ApxSocket | undefined;
  let stopped = false;
  let attempt = 0;
  const deps: PhoneDeps = {
    async location() {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return undefined;
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        ...(p.coords.accuracy == null ? {} : { accuracy_m: p.coords.accuracy }),
      };
    },
    photo,
  };
  const loop = async (): Promise<void> => {
    try {
      socket = await client.connect("node", [...PHONE_CAPS]);
      attempt = 0;
      socket.onRequest((method, params) => handlePhoneRequest(method, params, deps));
      await socket.closed;
    } catch {
      // the core is not reachable now
    }
    if (stopped) return;
    setTimeout(() => void loop(), RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
  };
  void loop();
  return () => {
    stopped = true;
    socket?.close();
  };
}

/**
 * Registers this phone's Expo push token with the core, so notices reach it while the app is closed. Without an EAS
 * project id there is no token: the owner can paste an ntfy address for this device in the panel instead.
 */
export async function registerPush(creds: Creds): Promise<boolean> {
  try {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return false;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    const client = new ApxClient({
      url: creds.url,
      token: creds.token,
      client: { name: "apx-mobile", version: "0.0.0" },
    });
    await client.call("devices.set_push", { push: { kind: "expo", token: data } });
    return true;
  } catch {
    return false;
  }
}
