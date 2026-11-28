// While a trip is on, the owner is at the wheel (rules/ERRANDS_ON_THE_WAY.md#driving-context): answers are short, and
// spoken when the owner asked for it.
import type { Store } from "../domain/store.ts";

/** The owner is driving now: car mode is on and a phone reported a trip that has not ended. */
export function ownerDriving(store: Store): boolean {
  return store.settings.read("car").enabled && Boolean(store.carTrips.active());
}

/** Chat replies to the owner start with a voice note while they drive (the `voice_while_driving` setting). */
export function voiceWhileDriving(store: Store): boolean {
  return store.settings.read("car").voice_while_driving && ownerDriving(store);
}

export const DRIVING_NOTE =
  "The owner is driving. Answer in one or two short spoken-style sentences, with nothing they would have to read on a screen; keep links, lists and code for later.";
