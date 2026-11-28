// What an offer says (rules/ERRANDS_ON_THE_WAY.md#delivery): the errand first, then the place, the distance and the
// street. The spoken text is for a voice in the car: no emoji, no "km", units in words.
import type { CarAction, CarAlert, CarDestination, CarPlace } from "@apx/protocol";

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

const ACTION_LABELS: Record<Lang, Record<CarAction, string>> = {
  es: {
    navigate: "Voy",
    add_stop: "Sumar parada",
    next: "Otro lugar",
    later: "Más tarde",
    skip: "No en este viaje",
    silence: "No me avises más",
    done: "Ya lo hice",
  },
  en: {
    navigate: "Go",
    add_stop: "Add as a stop",
    next: "Another place",
    later: "Later",
    skip: "Not this trip",
    silence: "No more this trip",
    done: "Done",
  },
};

export const actionLabel = (action: CarAction, lang: Lang): string => ACTION_LABELS[lang][action];

/** The answers a chat copy offers: a chat cannot add a stop to a route, so that one stays on the car and phone. */
export const CHAT_ACTIONS: readonly CarAction[] = ["navigate", "next", "later", "skip", "done", "silence"];

/** The offer as a chat message: the errand, then the place, the distance and the street. */
export function chatText(alert: CarAlert, lang: Lang): string {
  const where = alert.place.address ? ` (${alert.place.address})` : "";
  return lang === "es"
    ? `${alert.errand}: ${alert.place.name}${where}, a ${alert.distance_label} de tu camino.`
    : `${alert.errand}: ${alert.place.name}${where}, ${alert.distance_label} from your way.`;
}

/** What the chat says back to a pressed answer. */
export function chatAnswered(action: CarAction, lang: Lang, url?: string, next?: CarAlert): string {
  if (action === "navigate" || action === "add_stop") return lang === "es" ? `Dale: ${url ?? ""}` : `Go: ${url ?? ""}`;
  if (action === "next")
    return next
      ? chatText(next, lang)
      : lang === "es"
        ? "No encontré otro lugar cerca por ahora; te aviso si aparece."
        : "No other place nearby for now; I'll tell you if one shows up.";
  const said: Record<Exclude<CarAction, "navigate" | "add_stop" | "next">, [string, string]> = {
    later: ["Te lo vuelvo a ofrecer en un rato.", "I'll offer it again in a while."],
    skip: ["Queda para el próximo viaje.", "It waits for the next drive."],
    silence: ["No te aviso más en este viaje.", "No more offers this trip."],
    done: ["Listo, lo marqué como hecho.", "Done, marked as done."],
  };
  return said[action][lang === "es" ? 0 : 1];
}
