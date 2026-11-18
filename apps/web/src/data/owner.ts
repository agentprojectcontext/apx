import { useEffect } from "react";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { usePrefs } from "./prefs.ts";

const fromCore = createStore({ name: "", timezone: "", asked: false });

/** Reads the owner's name and time zone from the core once. */
function ask(): void {
  if (fromCore.get().asked) return;
  fromCore.set({ asked: true });
  void client
    .call("owner.get", {})
    .then((o) => fromCore.set({ name: o.name.trim(), timezone: o.timezone }))
    .catch(() => fromCore.set({ asked: false }));
}

/** The core's answer after it changed (Settings saved it, or signing in named the owner). */
export function ownerRead(o: { name: string; timezone: string }): void {
  fromCore.set({ name: o.name.trim(), timezone: o.timezone, asked: true });
}

/** How the panel names the owner in third person ("Alex assigned it"): this device's name, else the core's, else "". */
export function useOwnerName(): string {
  const local = usePrefs((s) => s.displayName);
  const core = useSlice(fromCore, (s) => s.name);
  useEffect(() => {
    if (!local) ask();
  }, [local]);
  return local || core;
}

/** The time zone the owner declared ("" while unknown or not set: the core's computer's). */
export function useOwnerTimeZone(): string {
  const zone = useSlice(fromCore, (s) => s.timezone);
  useEffect(ask, []);
  return zone;
}

const account = createStore({ photo: "", asked: false });

/** The APX account's photo once read, or after signing in or out here ("" when none). */
export function accountPhotoRead(photo: string): void {
  account.set({ photo, asked: true });
}

/** The signed-in account's photo for the sidebar's account row, read from the core once ("" signed out). */
export function useAccountPhoto(): string {
  const photo = useSlice(account, (s) => s.photo);
  useEffect(() => {
    if (account.get().asked) return;
    account.set({ asked: true });
    void client
      .call("account.get", {})
      .then((r) => account.set({ photo: r.profile?.photo ?? "" }))
      .catch(() => account.set({ asked: false }));
  }, []);
  return photo;
}
