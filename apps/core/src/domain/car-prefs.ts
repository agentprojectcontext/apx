// The owner's answers counted per place (rules/ERRANDS_ON_THE_WAY.md#preferred-places): what they went to ranks first
// next time, what they turned down later. A Google place keeps only its id and point, for 30 days unless chosen.
import type { CarPlace, ErrandCategory, PreferredPlace } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { CarPlacePrefsTable } from "../db/schema.ts";
import { categoriesOf } from "./car-places.ts";
import { qb, type Sql } from "./sql.ts";

const GOOGLE_DAYS = 30;

export type PrefCount = "accepted" | "declined" | "done";

function pref(r: Selectable<CarPlacePrefsTable>): PreferredPlace {
  return {
    key: r.key,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    categories: categoriesOf(r.categories),
    accepted: r.accepted,
    declined: r.declined,
    done: r.done,
    ...(r.choice === "prefer" || r.choice === "avoid" ? { choice: r.choice } : {}),
    last_at: r.last_at,
  };
}

export function carPrefsRepo({ one, all, run }: Sql) {
  const prune = (at: string) =>
    run(
      qb
        .deleteFrom("car_place_prefs")
        .where("source", "=", "google")
        .where("choice", "is", null)
        .where("last_at", "<", new Date(Date.parse(at) - GOOGLE_DAYS * 86_400_000).toISOString()),
    );
  const repo = {
    get(key: string): PreferredPlace | undefined {
      const r = one(qb.selectFrom("car_place_prefs").selectAll().where("key", "=", key));
      return r ? pref(r) : undefined;
    },
    of(keys: readonly string[]): Map<string, PreferredPlace> {
      if (!keys.length) return new Map();
      const rows = all(
        qb
          .selectFrom("car_place_prefs")
          .selectAll()
          .where("key", "in", [...keys]),
      );
      return new Map(rows.map((r) => [r.key, pref(r)]));
    },
    /** Keys the owner said never to offer. */
    avoided(): Set<string> {
      return new Set(
        all(qb.selectFrom("car_place_prefs").select("key").where("choice", "=", "avoid")).map((r) => r.key),
      );
    },
    /** Counts one answer for a place, adding it the first time. */
    count(place: CarPlace, categories: readonly ErrandCategory[], what: PrefCount, at: string): void {
      // Google's terms: the name shown is not stored, only the id and the point.
      const name = place.source === "google" ? "" : place.name;
      run(
        qb
          .insertInto("car_place_prefs")
          .values({
            key: place.key,
            name,
            lat: place.lat,
            lon: place.lon,
            categories: JSON.stringify(categories),
            [what]: 1,
            last_at: at,
            source: place.source,
          })
          .onConflict((oc) =>
            oc.column("key").doUpdateSet((eb) => ({
              [what]: eb(eb.ref(`car_place_prefs.${what}`), "+", 1),
              last_at: at,
              ...(name ? { name } : {}),
            })),
          ),
      );
      prune(at);
    },
    choose(key: string, choice: "prefer" | "avoid" | null): PreferredPlace | undefined {
      run(qb.updateTable("car_place_prefs").set({ choice }).where("key", "=", key));
      return repo.get(key);
    },
    forget(key: string): void {
      run(qb.deleteFrom("car_place_prefs").where("key", "=", key));
    },
    /** The places the owner uses: chosen ones first, then by answers, newest first. */
    list(limit: number, at: string): PreferredPlace[] {
      prune(at);
      return all(
        qb
          .selectFrom("car_place_prefs")
          .selectAll()
          .orderBy((eb) => eb.case().when("choice", "=", "prefer").then(0).else(1).end())
          .orderBy((eb) => eb(eb("accepted", "+", eb.ref("done")), "-", eb.ref("declined")), "desc")
          .orderBy("last_at", "desc")
          .limit(limit),
      ).map(pref);
    },
  };
  return repo;
}
