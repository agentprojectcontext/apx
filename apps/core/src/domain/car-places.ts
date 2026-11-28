// OpenStreetMap places cached by tile (rules/ERRANDS_ON_THE_WAY.md#providers): ODbL allows storing them; Google's
// places never reach this table.
import { ErrandCategory } from "@apx/protocol";
import type { PlaceCache, StoredPlace } from "../car/provider.ts";
import { opt, qb, type Sql } from "./sql.ts";

/** A stored list of categories, without any that is no longer known. */
export const categoriesOf = (json: string): ErrandCategory[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.flatMap((c) => (ErrandCategory.safeParse(c).success ? [c as ErrandCategory] : [])) : [];
  } catch {
    return [];
  }
};

export function carPlacesRepo({ all, run, tx }: Sql): PlaceCache {
  return {
    freshTiles(keys, since) {
      if (!keys.length) return new Set();
      const rows = all(
        qb
          .selectFrom("car_place_tiles")
          .select("key")
          .where("key", "in", [...keys])
          .where("fetched_at", ">", since),
      );
      return new Set(rows.map((r) => r.key));
    },
    putTile(key, places, at) {
      tx(() => {
        run(qb.deleteFrom("car_places").where("tile", "=", key));
        for (const p of places)
          run(
            qb
              .insertInto("car_places")
              .values({
                key: p.key,
                tile: key,
                name: p.name,
                lat: p.lat,
                lon: p.lon,
                categories: JSON.stringify(p.categories),
                brand: p.brand ?? null,
                address: p.address ?? null,
                opening_hours: p.opening_hours ?? null,
              })
              // A place on a tile's edge may come in two fetches: the newest tile keeps it.
              .onConflict((oc) =>
                oc.column("key").doUpdateSet((eb) => ({
                  tile: eb.ref("excluded.tile"),
                  name: eb.ref("excluded.name"),
                  lat: eb.ref("excluded.lat"),
                  lon: eb.ref("excluded.lon"),
                  categories: eb.ref("excluded.categories"),
                  brand: eb.ref("excluded.brand"),
                  address: eb.ref("excluded.address"),
                  opening_hours: eb.ref("excluded.opening_hours"),
                })),
              ),
          );
        run(
          qb
            .insertInto("car_place_tiles")
            .values({ key, fetched_at: at })
            .onConflict((oc) => oc.column("key").doUpdateSet({ fetched_at: at })),
        );
      });
    },
    placesIn(keys) {
      if (!keys.length) return [];
      return all(
        qb
          .selectFrom("car_places")
          .selectAll()
          .where("tile", "in", [...keys]),
      ).map(
        (r): StoredPlace => ({
          key: r.key,
          name: r.name,
          lat: r.lat,
          lon: r.lon,
          categories: categoriesOf(r.categories),
          ...opt("brand", r.brand),
          ...opt("address", r.address),
          ...opt("opening_hours", r.opening_hours),
        }),
      );
    },
  };
}
