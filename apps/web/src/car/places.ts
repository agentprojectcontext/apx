// Errand places on screen: each category's name, a distance said briefly, and a point read from what the owner pastes.
import type { ErrandCategory, LatLon } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";

export const CATEGORIES: readonly ErrandCategory[] = [
  "supermarket",
  "grocery",
  "butcher",
  "bakery",
  "kiosk",
  "pharmacy",
  "stationery",
  "bookstore",
  "hardware",
  "electronics",
  "clothing",
  "pet_store",
  "garden",
  "florist",
  "liquor",
  "optician",
  "gas_station",
  "car_service",
  "atm",
  "bank",
  "post_office",
  "laundry",
  "pickup",
];

export const categoryKey = (c: ErrandCategory): MessageKey => `car.cat.${c}` as MessageKey;

/** "650 m", "1.4 km" (the language's decimal mark). */
export function distanceText(m: number, locale: string): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toLocaleString(locale, { maximumFractionDigits: m < 10_000 ? 1 : 0 })} km`;
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
// Most precise first: a place's pin (!3d…!4d…), a query or destination, the map's centre (@lat,lon), plain text.
const FORMS = [
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(String.raw`[?&](?:q|query|ll|destination|daddr|center)=${NUM}(?:,|%2C)\s*${NUM}`, "i"),
  new RegExp(`@${NUM},${NUM}`),
  new RegExp(String.raw`^\s*${NUM}\s*[,;\s]\s*${NUM}\s*$`),
];

/** A point from a Google Maps link or "lat, lon"; undefined when the text holds none. */
export function parsePoint(text: string): LatLon | undefined {
  for (const form of FORMS) {
    const m = form.exec(text.trim());
    if (!m) continue;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      return { lat, lon };
  }
  return undefined;
}
