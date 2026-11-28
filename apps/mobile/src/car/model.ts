// Car mode on the phone, without React: what its checklist, status line and trip banner say, the answers an offer
// shows, and how the errand place form reads and writes a task's `place`. See rules/ERRANDS_ON_THE_WAY.md.
import type { CarAction, CarTripView, ErrandCategory, ErrandPlace } from "../../../../packages/protocol/src/car.ts";
import type { Key } from "../i18n/index.ts";
import type { CarNativeConfig, CarNativeStatus } from "./native.ts";

/** Every category in the order the form shows them, with its label; the Record keeps the list complete. */
export const CATEGORY_KEY: Record<ErrandCategory, Key> = {
  supermarket: "carCatSupermarket",
  grocery: "carCatGrocery",
  butcher: "carCatButcher",
  bakery: "carCatBakery",
  kiosk: "carCatKiosk",
  pharmacy: "carCatPharmacy",
  stationery: "carCatStationery",
  bookstore: "carCatBookstore",
  hardware: "carCatHardware",
  electronics: "carCatElectronics",
  clothing: "carCatClothing",
  pet_store: "carCatPetStore",
  garden: "carCatGarden",
  florist: "carCatFlorist",
  liquor: "carCatLiquor",
  optician: "carCatOptician",
  gas_station: "carCatGasStation",
  car_service: "carCatCarService",
  atm: "carCatAtm",
  bank: "carCatBank",
  post_office: "carCatPostOffice",
  laundry: "carCatLaundry",
  pickup: "carCatPickup",
};
export const CATEGORIES = Object.keys(CATEGORY_KEY) as ErrandCategory[];
/** The core keeps at most this many per errand. */
export const MAX_CATEGORIES = 4;

/** What the errand form edits: the kinds of shop (best first) and a brand, as typed. */
export type PlaceForm = { categories: ErrandCategory[]; brand: string };

export function placeForm(place: ErrandPlace | undefined): PlaceForm {
  return { categories: [...(place?.categories ?? [])], brand: place?.brand ?? "" };
}

/** A category picked goes last (the first stays the best); picked again it goes; past the cap nothing changes. */
export function toggleCategory(categories: readonly ErrandCategory[], category: ErrandCategory): ErrandCategory[] {
  if (categories.includes(category)) return categories.filter((item) => item !== category);
  return categories.length >= MAX_CATEGORIES ? [...categories] : [...categories, category];
}

/**
 * The place to save: the form over what the task had (a fixed point or a radius set elsewhere stays). Nothing left:
 * `null`, which tasks.update takes as "clear" (a new task sends no place).
 */
export function placeFromForm(form: PlaceForm, before?: ErrandPlace): ErrandPlace | null {
  const brand = form.brand.replace(/\s+/g, " ").trim().slice(0, 60);
  const place: ErrandPlace = {
    categories: form.categories.slice(0, MAX_CATEGORIES),
    ...(brand ? { brand } : {}),
    ...(before?.at ? { at: before.at } : {}),
    ...(before?.radius_m ? { radius_m: before.radius_m } : {}),
  };
  return place.categories.length || place.brand || place.at ? place : null;
}

/** Whether two places say the same, so an unchanged form saves nothing. */
export function samePlace(a: ErrandPlace | null | undefined, b: ErrandPlace | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** What car mode needs on this phone, in the order the owner sets it up, each with whether it is done. */
export type CheckItem = { id: "listener" | "location" | "notifications"; label: Key; help: Key; done: boolean };

export function checklist(status: CarNativeStatus): CheckItem[] {
  return [
    { id: "listener", label: "carNeedListener", help: "carNeedListenerHelp", done: status.listener },
    { id: "location", label: "carNeedLocation", help: "carNeedLocationHelp", done: status.location },
    {
      id: "notifications",
      label: "carNeedNotifications",
      help: "carNeedNotificationsHelp",
      done: status.notifications,
    },
  ];
}

/** One line on where car mode stands: a trip, the car, or waiting for it; with when a position last reached APX. */
export type StatusLine = { key: Key; sent?: string; tone: "brand" | "neutral" | "warning" };

export function statusLine(status: CarNativeStatus): StatusLine | undefined {
  if (!status.enabled) return undefined;
  const sent = status.last_sent_at ? { sent: status.last_sent_at } : {};
  if (status.trip)
    return { key: status.trip.source === "manual" ? "carTestTripOn" : "carTripOn", tone: "brand", ...sent };
  if (status.car_connected) return { key: "carConnected", tone: "brand", ...sent };
  if (checklist(status).some((item) => !item.done)) return { key: "carNeedsSetup", tone: "warning" };
  return { key: "carWaiting", tone: "neutral", ...sent };
}

/** The answers an offer shows on the phone, in order; the first is the main one. */
export const ANSWERS: ReadonlyArray<{ action: CarAction; label: Key }> = [
  { action: "navigate", label: "carAnswerGo" },
  { action: "next", label: "carAnswerNext" },
  { action: "later", label: "carAnswerLater" },
  { action: "skip", label: "carAnswerSkip" },
  { action: "done", label: "carAnswerDone" },
];

/** The answers this offer takes (the core may leave some out, e.g. no other place to try). */
export function answersFor(actions: readonly CarAction[]): Array<{ action: CarAction; label: Key }> {
  return ANSWERS.filter((answer) => actions.includes(answer.action));
}

/** Whether a trip is on, as the core or this phone sees it, and how many offers wait for an answer. */
export function tripSummary(
  view: CarTripView | undefined,
  native: CarNativeStatus | undefined,
): { active: boolean; waiting: number } {
  const active = Boolean((view?.trip && !view.trip.ended_at) || native?.trip);
  const waiting = active ? (view?.alerts ?? []).filter((alert) => !alert.answer).length : 0;
  return { active, waiting };
}

/** What the native side needs to talk to the core; unpaired, an empty key and off. */
export function nativeConfig(
  creds: { url: string; token: string } | undefined,
  enabled: boolean,
  lang: string,
  agentName?: string,
): CarNativeConfig {
  return {
    url: creds?.url ?? "",
    token: creds?.token ?? "",
    enabled: Boolean(creds) && enabled,
    lang,
    ...(agentName ? { agent_name: agentName } : {}),
  };
}

/** A distance for a list row, as the offers write it: meters under one kilometer. */
export function distanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}
