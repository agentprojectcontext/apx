// Google Places (New) Text Search with the owner's key (rules/ERRANDS_ON_THE_WAY.md#providers). Results stay in
// memory only, a few minutes, as Google's terms ask; nothing reaches the disk.
import type { ErrandCategory } from "@apx/protocol";
import { errorMessage, unavailable } from "../errors.ts";
import { CATEGORIES, CATEGORY_IDS } from "./categories.ts";
import { distanceM } from "./geo.ts";
import type { Fetch, FoundPlace, PlaceProvider, SearchArea } from "./provider.ts";

export const GOOGLE_TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText";
export const GOOGLE_FIELD_MASK =
  "places.id,places.displayName,places.location,places.types,places.formattedAddress,places.currentOpeningHours.openNow,places.rating";

const DEADLINE_MS = 10_000;
const MEMORY_MS = 10 * 60 * 1000;
const MEMORY_MAX = 200;
const MAX_CATEGORIES = 3;

export type GoogleOptions = {
  key: string | undefined;
  fetch: Fetch;
  /** Language of the text query and of the names Google answers with. */
  language?: "es" | "en";
  now?: () => Date;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  formattedAddress?: string;
  currentOpeningHours?: { openNow?: boolean };
  rating?: number;
};

/** The request body for one category around a point. */
function textSearchBody(area: SearchArea, category: ErrandCategory, language: "es" | "en") {
  const def = CATEGORIES[category];
  return {
    textQuery: def.googleQuery[language],
    ...(def.googleType ? { includedType: def.googleType, strictTypeFiltering: true } : {}),
    locationBias: {
      circle: { center: { latitude: area.lat, longitude: area.lon }, radius: Math.min(area.radius_m, 50_000) },
    },
    maxResultCount: 10,
    languageCode: language,
  };
}

const typeToCategories = new Map<string, ErrandCategory[]>();
for (const cat of CATEGORY_IDS) {
  const t = CATEGORIES[cat].googleType;
  if (t) typeToCategories.set(t, [...(typeToCategories.get(t) ?? []), cat]);
}

function toFound(p: GooglePlace, category: ErrandCategory): FoundPlace | undefined {
  const lat = p.location?.latitude;
  const lon = p.location?.longitude;
  const name = p.displayName?.text;
  if (!p.id || !name || lat === undefined || lon === undefined) return undefined;
  const categories = [category];
  for (const t of p.types ?? []) {
    for (const c of typeToCategories.get(t) ?? []) if (!categories.includes(c)) categories.push(c);
  }
  const openNow = p.currentOpeningHours?.openNow;
  return {
    key: `google:${p.id}`,
    name,
    lat,
    lon,
    address: p.formattedAddress,
    category,
    categories,
    open: openNow === undefined ? undefined : openNow ? "open" : "closed",
    rating: p.rating,
    source: "google",
  };
}

export function googleProvider(opts: GoogleOptions): PlaceProvider {
  const language = opts.language ?? "es";
  const now = opts.now ?? (() => new Date());
  const memory = new Map<string, { at: number; places: FoundPlace[] }>();

  function remember(key: string, places: FoundPlace[]): void {
    memory.delete(key);
    memory.set(key, { at: now().getTime(), places });
    while (memory.size > MEMORY_MAX) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  }

  function recall(key: string): FoundPlace[] | undefined {
    const hit = memory.get(key);
    if (!hit) return undefined;
    if (now().getTime() - hit.at > MEMORY_MS) {
      memory.delete(key);
      return undefined;
    }
    memory.delete(key);
    memory.set(key, hit);
    return hit.places;
  }

  async function searchOne(area: SearchArea, category: ErrandCategory, key: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    // About 100 m of rounding: the car moves, the answer for the block does not.
    const memoKey = `${area.lat.toFixed(3)},${area.lon.toFixed(3)},${Math.round(area.radius_m / 100)},${category},${language}`;
    const cached = recall(memoKey);
    if (cached) return cached;
    const deadline = AbortSignal.timeout(DEADLINE_MS);
    let res: Response;
    try {
      res = await opts.fetch(GOOGLE_TEXT_SEARCH, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
          "x-goog-fieldmask": GOOGLE_FIELD_MASK,
        },
        body: JSON.stringify(textSearchBody(area, category, language)),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw unavailable(`Google Places is unavailable: ${errorMessage(err, 160)}`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => undefined)) as { error?: { status?: string } } | undefined;
      throw unavailable(`Google Places answered ${res.status}${body?.error?.status ? ` (${body.error.status})` : ""}`);
    }
    const json = (await res.json()) as { places?: GooglePlace[] };
    signal?.throwIfAborted();
    const places = (json.places ?? []).map((p) => toFound(p, category)).filter((p): p is FoundPlace => p !== undefined);
    remember(memoKey, places);
    return places;
  }

  return {
    id: "google",
    async search(area: SearchArea, categories: readonly ErrandCategory[], _at: Date, signal?: AbortSignal) {
      const key = opts.key?.trim();
      if (!key) throw unavailable("Google Places needs an API key: add one in car settings or use OpenStreetMap");
      const byKey = new Map<string, FoundPlace & { d: number }>();
      for (const category of categories.slice(0, MAX_CATEGORIES)) {
        for (const p of await searchOne(area, category, key, signal)) {
          const d = distanceM(area, p);
          // The location is only a bias: Google may answer with places outside the circle.
          if (d > area.radius_m || byKey.has(p.key)) continue;
          byKey.set(p.key, { ...p, d });
        }
      }
      return [...byKey.values()].sort((a, b) => a.d - b.d).map(({ d: _d, ...p }) => p);
    },
  };
}
