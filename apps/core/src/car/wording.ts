// What an offer says (rules/ERRANDS_ON_THE_WAY.md#delivery): the errand first, then the place, the distance and the
// street. The spoken text is for a voice in the car: no emoji, no "km", units in words.
import type { CarDestination, CarPlace } from "@apx/protocol";

export type Lang = "es" | "en";

/** Rounded the way a person says it: hundreds of metres under a kilometre, tenths of a kilometre above. */
function rounded(m: number): { metres: number } | { km: number } {
  if (m < 950) return { metres: Math.max(100, Math.round(m / 100) * 100) };
  return { km: Math.round(m / 100) / 10 };
}

const decimal = (n: number, lang: Lang) => (lang === "es" ? String(n).replace(".", ",") : String(n));

/** For a chip: "900 m", "1,4 km" (Spanish) or "1.4 km". */
export function distanceLabel(m: number, lang: Lang): string {
  const r = rounded(m);
  return "metres" in r ? `${r.metres} m` : `${decimal(r.km, lang)} km`;
}

/** For a voice: "a 900 metros", "a un kilómetro y medio"; "900 meters away", "a kilometer and a half away". */
export function spokenDistance(m: number, lang: Lang): string {
  const r = rounded(m);
  if (lang === "es") {
    if ("metres" in r) return `a ${r.metres} metros`;
    if (r.km === 1) return "a un kilómetro";
    if (r.km === 1.5) return "a un kilómetro y medio";
    return `a ${decimal(r.km, lang)} kilómetros`;
  }
  if ("metres" in r) return `${r.metres} meters away`;
  if (r.km === 1) return "a kilometer away";
  if (r.km === 1.5) return "a kilometer and a half away";
  return `${decimal(r.km, lang)} kilometers away`;
}

export function offerTitle(errand: string, place: Pick<CarPlace, "name">, distance_m: number, lang: Lang): string {
  return `${errand} · ${place.name} · ${distanceLabel(distance_m, lang)}`;
}

export function offerSpoken(
  errand: string,
  place: Pick<CarPlace, "name" | "address">,
  distance_m: number,
  lang: Lang,
): string {
  const street = place.address ? (lang === "es" ? `, en ${place.address}` : `, on ${place.address}`) : "";
  return `${errand}: ${place.name}, ${spokenDistance(distance_m, lang)}${street}.`;
}

const MAPS = "https://www.google.com/maps/dir/?api=1";
const point = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;

/** Google Maps, driving to the place. */
export function navigateUrl(place: { lat: number; lon: number }): string {
  return `${MAPS}&destination=${point(place)}&travelmode=driving`;
}

/** Google Maps, driving to the trip's destination with the place as a stop; unset without a destination. */
export function addStopUrl(place: { lat: number; lon: number }, destination?: CarDestination): string | undefined {
  const to =
    destination?.lat !== undefined && destination.lon !== undefined
      ? point({ lat: destination.lat, lon: destination.lon })
      : destination?.label
        ? encodeURIComponent(destination.label)
        : undefined;
  return to ? `${MAPS}&destination=${to}&waypoints=${point(place)}&travelmode=driving` : undefined;
}
