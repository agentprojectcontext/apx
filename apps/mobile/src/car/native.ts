// Car mode's native side (modules/apx-car, Android only): it watches for Android Auto and Maps, runs the location
// service during a trip, and draws the APX car app. The JS app only hands it the core's address and this phone's key,
// turns it on or off, and reads its state. See rules/ERRANDS_ON_THE_WAY.md.
import { Platform } from "react-native";

export type CarNativeStatus = {
  /** This build has the native side (Android, a build made after it existed). */
  available: boolean;
  /** Car mode is on in this phone. */
  enabled: boolean;
  privacy_blocked?: boolean;
  /** The owner allowed APX to read notifications (how it sees Android Auto and Maps). */
  listener: boolean;
  /** Precise location while in use is allowed. */
  location: boolean;
  /** APX may show notifications. */
  notifications: boolean;
  /** Android Auto is connected now. */
  car_connected: boolean;
  /** The trip in course, as this phone sees it. */
  trip?: { id: string; source: "android_auto" | "maps" | "manual"; started_at: string } | undefined;
  /** When the last position reached the core. */
  last_sent_at?: string | undefined;
  /** The last thing that went wrong, in the owner's words (no permission, the core did not answer…). */
  last_error?: string | undefined;
};

export type CarNativeConfig = {
  url: string;
  token: string;
  enabled: boolean;
  /** "es" or "en": the car screens' and voice replies' language. */
  lang: string;
  /** The super-agent's name, for "Talk to <name>" on the car. */
  agent_name?: string | undefined;
};

type NativeModule = {
  configure(config: CarNativeConfig): Promise<void>;
  status(): Promise<CarNativeStatus>;
  allowTrips(): Promise<void>;
  pauseTrips(): Promise<void>;
  openListenerSettings(): Promise<void>;
  /** A trip without a car, to try it out: positions go to the core until stopTestTrip. */
  startTestTrip(): Promise<void>;
  stopTestTrip(): Promise<void>;
  addListener(event: "status", cb: (s: CarNativeStatus) => void): { remove(): void };
};

const OFF: CarNativeStatus = {
  available: false,
  enabled: false,
  listener: false,
  location: false,
  notifications: false,
  car_connected: false,
};

function load(): NativeModule | undefined {
  if (Platform.OS !== "android") return undefined;
  try {
    // A build without the module (or iOS) has none: car mode is then simply unavailable.
    const { requireOptionalNativeModule } = require("expo-modules-core") as {
      requireOptionalNativeModule: (name: string) => NativeModule | null;
    };
    return requireOptionalNativeModule("ApxCar") ?? undefined;
  } catch {
    return undefined;
  }
}

const mod = load();

export const carNative = {
  available: Boolean(mod),
  allowTrips: (): Promise<void> => mod?.allowTrips?.() ?? Promise.resolve(),
  pauseTrips: (): Promise<void> => mod?.pauseTrips?.() ?? Promise.resolve(),
  configure: (c: CarNativeConfig): Promise<void> => mod?.configure(c) ?? Promise.resolve(),
  status: async (): Promise<CarNativeStatus> => (mod ? { ...(await mod.status()), available: true } : OFF),
  openListenerSettings: (): Promise<void> => mod?.openListenerSettings() ?? Promise.resolve(),
  startTestTrip: (): Promise<void> => mod?.startTestTrip() ?? Promise.resolve(),
  stopTestTrip: (): Promise<void> => mod?.stopTestTrip() ?? Promise.resolve(),
  onStatus(cb: (s: CarNativeStatus) => void): () => void {
    const sub = mod?.addListener("status", (s) => cb({ ...s, available: true }));
    return () => sub?.remove();
  },
};
