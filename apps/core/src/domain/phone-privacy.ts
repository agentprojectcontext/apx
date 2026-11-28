import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";

const KEY = "phone_privacy";
const TRIP_REVISION = "trip_privacy_revision";
export const tripPrivacyRevision = (store: Store): string => store.settings.get(TRIP_REVISION) ?? "initial";
export function revokeTripConsent(store: Store): void {
  store.settings.set(TRIP_REVISION, randomUUID());
}
export type PhonePrivacy = { location: boolean; trips: boolean; revision: string };

/** Existing installs retain their choices; OS permission and the car's opt-in remain required. */
export function phonePrivacy(store: Store): PhonePrivacy {
  const raw = store.settings.get(KEY);
  if (!raw) return { location: true, trips: true, revision: "initial" };
  try {
    const value = JSON.parse(raw) as Partial<PhonePrivacy>;
    return {
      location: value.location === true,
      trips: value.trips === true,
      revision: typeof value.revision === "string" ? value.revision : "invalid",
    };
  } catch {
    return { location: false, trips: false, revision: "invalid" };
  }
}

export function configurePhonePrivacy(
  store: Store,
  patch: Partial<Pick<PhonePrivacy, "location" | "trips">>,
): PhonePrivacy {
  const next = { ...phonePrivacy(store), ...patch, revision: randomUUID() };
  store.settings.set(KEY, JSON.stringify(next));
  if (patch.trips === false) revokeTripConsent(store);
  return next;
}
