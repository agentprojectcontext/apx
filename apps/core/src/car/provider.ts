// Where errands' places come from (rules/ERRANDS_ON_THE_WAY.md#providers): a search around a point for some
// categories. OpenStreetMap is the keyless default; Google is the owner's key. Both fail closed (an error, never a guess).
import type { CarPlace, ErrandCategory } from "@apx/protocol";

export type SearchArea = { lat: number; lon: number; radius_m: number };

/** A place as a provider found it, with what the matcher needs beyond what a screen shows. */
export type FoundPlace = CarPlace & {
  categories: ErrandCategory[];
  /** The chain or operator ("La Anónima", "Farmacity"), to match an errand's brand. */
  brand?: string | undefined;
  /** OSM `opening_hours` as written; `open`/`closes_soon` are already evaluated for the search time. */
  opening_hours?: string | undefined;
};

export interface PlaceProvider {
  readonly id: "osm" | "google";
  /** Places of any of `categories` within the area, evaluated (open, closes soon) at `at`. */
  search(
    area: SearchArea,
    categories: readonly ErrandCategory[],
    at: Date,
    signal?: AbortSignal,
  ): Promise<FoundPlace[]>;
}

/** The OSM provider's store (tables car_place_tiles and car_places): tiles fetched, and the places in them. */
export interface PlaceCache {
  /** Of these tile keys, those fetched after `since` (ISO time). */
  freshTiles(keys: readonly string[], since: string): Set<string>;
  /** Replaces a tile's places with a new fetch, at `at`. */
  putTile(key: string, places: readonly StoredPlace[], at: string): void;
  /** Places stored for these tiles. */
  placesIn(keys: readonly string[]): StoredPlace[];
}

/** A cached OSM place: what is stored (ODbL allows it); open/closed is evaluated when read. */
export type StoredPlace = {
  key: string;
  name: string;
  lat: number;
  lon: number;
  categories: ErrandCategory[];
  brand?: string | undefined;
  address?: string | undefined;
  opening_hours?: string | undefined;
};

/** A fetch that can be replaced in tests; the real one is globalThis.fetch with a User-Agent. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
