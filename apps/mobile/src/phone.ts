// The phone as a node (it lends its location and camera to the core) and its push registration. Both run while the
// app is paired; the node link reconnects on its own.
import * as Location from "expo-location";
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
  let retry: ReturnType<typeof setTimeout> | undefined;
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
      if (stopped) {
        socket.close();
        return;
      }
      attempt = 0;
      socket.onRequest((method, params) => handlePhoneRequest(method, params, deps));
      await socket.closed;
    } catch {
      // the core is not reachable now
    }
    if (stopped) return;
    retry = setTimeout(() => void loop(), RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
  };
  void loop();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}
