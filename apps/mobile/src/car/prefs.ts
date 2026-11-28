// Whether car mode is on for this phone, kept across launches (secure storage is the app's one store). The core has
// its own switch (car.configure); this one says whether this phone watches for the car.
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

const KEY = "apx.car.enabled";
let current = false;
let loaded: Promise<boolean> | undefined;
const listeners = new Set<(on: boolean) => void>();

export function loadCarEnabled(): Promise<boolean> {
  loaded ??= SecureStore.getItemAsync(KEY)
    .catch(() => null)
    .then((raw) => {
      current = raw === "on";
      return current;
    });
  return loaded;
}

export async function saveCarEnabled(on: boolean): Promise<void> {
  current = on;
  loaded = Promise.resolve(on);
  for (const listener of listeners) listener(on);
  await SecureStore.setItemAsync(KEY, on ? "on" : "off").catch(() => undefined);
}

/** The stored choice, `undefined` until read. */
export function useCarEnabled(): boolean | undefined {
  const [on, setOn] = useState<boolean>();
  useEffect(() => {
    let live = true;
    void loadCarEnabled().then((value) => live && setOn(value));
    listeners.add(setOn);
    return () => {
      live = false;
      listeners.delete(setOn);
    };
  }, []);
  return on;
}
