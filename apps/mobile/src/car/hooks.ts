// Car mode's hooks: the native side's state, handing it the core's address and key, and the trip as the core sees it.
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking } from "react-native";
import type { CarAction, CarTripView } from "../../../../packages/protocol/src/car.ts";
import type { Creds } from "../creds";
import { lang } from "../i18n";
import type { CoreEvent } from "../protocol";
import { nativeConfig } from "./model";
import { type CarNativeStatus, carNative } from "./native";
import { saveCarEnabled, useCarEnabled } from "./prefs";

/** The native side's state, read at start, on each change it reports and when the app comes back. */
export function useCarNative(): { status: CarNativeStatus | undefined; refresh: () => void } {
  const [status, setStatus] = useState<CarNativeStatus>();
  const refresh = useCallback(() => {
    void carNative
      .status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const stop = carNative.onStatus(setStatus);
    const app = AppState.addEventListener("change", (state) => state === "active" && refresh());
    return () => {
      stop();
      app.remove();
    };
  }, [refresh]);
  return { status, refresh };
}

/**
 * Keeps the native side told the core's address, this phone's key and whether car mode is on; again on each return
 * to the app, so it can retry a service start the system refused while the app was away.
 */
export function useCarSync(creds: Creds, agentName?: string): void {
  const enabled = useCarEnabled();
  useEffect(() => {
    if (!carNative.available || enabled === undefined) return;
    const observe = (status: CarNativeStatus) => {
      if (status.privacy_blocked) void saveCarEnabled(false);
    };
    const send = () =>
      void carNative
        .configure(nativeConfig(creds, enabled, lang, agentName))
        .then(() => carNative.status())
        .then(observe)
        .catch(() => undefined);
    const stop = carNative.onStatus(observe);
    send();
    const app = AppState.addEventListener("change", (state) => state === "active" && send());
    return () => {
      stop();
      app.remove();
    };
  }, [creds, enabled, agentName]);
}

/** Unpaired: the native side stops and forgets the key. */
export function forgetCarCore(): Promise<void> {
  if (!carNative.available) return Promise.resolve();
  return carNative.configure(nativeConfig(undefined, false, lang)).catch(() => undefined);
}

type Call = (method: string, params: Record<string, unknown>) => Promise<unknown>;
type Listen = (cb: (event: CoreEvent) => void) => () => void;

/**
 * The trip as the core has it (its waiting offers and open errands), read again on `car.updated`, when this phone's
 * trip changes and on each return to the app. A core without car mode answers nothing and the trip stays empty.
 */
export function useCarTrip(call: Call, listen: Listen, nativeTrip?: string) {
  const [view, setView] = useState<CarTripView>();
  const reload = useCallback(() => {
    void (call("car.trip", {}) as Promise<CarTripView>).then(setView).catch(() => undefined);
  }, [call]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new trip id on this phone is a reason to read again
  useEffect(() => {
    reload();
  }, [reload, nativeTrip]);
  useEffect(() => {
    const stop = listen((event) => event.type === "car.updated" && reload());
    const app = AppState.addEventListener("change", (state) => state === "active" && reload());
    return () => {
      stop();
      app.remove();
    };
  }, [listen, reload]);
  /** An answer to an offer; going opens Maps there. */
  const answer = useCallback(
    async (alertId: string, action: CarAction) => {
      const alert = view?.alerts.find((item) => item.id === alertId);
      const sent = call("car.answer", { alert_id: alertId, action });
      if (action === "navigate" && alert) void Linking.openURL(alert.navigate_url).catch(() => undefined);
      await sent;
      reload();
    },
    [call, reload, view],
  );
  return { view, reload, answer };
}
