// The phone as a node (it lends its location and camera to the core) and its push registration. Both run while the
// app is paired; the node link reconnects on its own.
import * as Location from "expo-location";
import { AppState } from "react-native";
import type { Creds } from "./creds";
import { capturePhoneLocation } from "./phoneLocation";
import { handlePhoneRequest, PHONE_CAPS, type PhoneDeps } from "./phoneRequests";
import { ApxClient, type ApxSocket } from "./protocol";

const RETRY_MS = [2000, 5000, 15000, 30000];

/** Keeps a node link to the core; `photo` shows the camera to the owner. Returns a stop function. */
export function startPhoneNode(creds: Creds, photo: PhoneDeps["photo"]): () => void {
  const client = new ApxClient({ url: creds.url, token: creds.token, client: { name: "apx-phone", version: "0.0.0" } });
  let socket: ApxSocket | undefined;
  let stopped = false;
  const captures = new Set<() => void>();
  const app = AppState.addEventListener("change", (state) => {
    if (state !== "active") for (const stop of captures) stop();
  });
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const deps: PhoneDeps = {
    async location() {
      const requested = socket;
      const captureAfter = Date.now();
      const captureUntil = captureAfter + 8000;
      return capturePhoneLocation({
        privacy: () => client.call("phone.privacy", {}),
        onStop: (stop) => {
          if (
            stopped ||
            !requested ||
            socket !== requested ||
            AppState.currentState !== "active" ||
            Date.now() >= captureUntil
          )
            stop();
          else captures.add(stop);
          return () => {
            captures.delete(stop);
          };
        },
        permitted: async () =>
          !stopped &&
          Date.now() < captureUntil &&
          AppState.currentState === "active" &&
          (await Location.getForegroundPermissionsAsync()).granted,
        watch: (receive) =>
          Location.watchPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: false }, (p) => {
            if (!Number.isFinite(p.timestamp) || p.timestamp < captureAfter) return;
            receive({
              lat: p.coords.latitude,
              lon: p.coords.longitude,
              ...(p.coords.accuracy == null ? {} : { accuracy_m: p.coords.accuracy }),
            });
          }),
        poll: (check) => {
          const timer = setInterval(check, 1000);
          return () => clearInterval(timer);
        },
        deadline: (stop) => {
          const timer = setTimeout(stop, Math.max(0, captureUntil - Date.now()));
          return () => clearTimeout(timer);
        },
      });
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
      socket = undefined;
      for (const stop of captures) stop();
    } catch {
      // the core is not reachable now
    }
    if (stopped) return;
    retry = setTimeout(() => void loop(), RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
  };
  void loop();
  return () => {
    stopped = true;
    app.remove();
    for (const stop of captures) stop();
    captures.clear();
    clearTimeout(retry);
    socket?.close();
  };
}
