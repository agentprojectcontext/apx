// Offers made in a trip and what the owner held with their answers (rules/ERRANDS_ON_THE_WAY.md#the-matcher-per-position).
// An offer keeps a snapshot of its place, so it reads the same after the place cache changes.
import { CarAction, CarPlace } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { CarAlertsTable } from "../db/schema.ts";
import { newId, opt, qb, type Sql } from "./sql.ts";

export type AlertRow = {
  id: string;
  trip_id: string;
  task_id: string;
  errand: string;
  place: CarPlace;
  distance_m: number;
  at: string;
  answer?: CarAction | undefined;
  answered_at?: string | undefined;
};

type HoldKind = "skip" | "later" | "lock" | "declined_place";

export type Hold = {
  task_id: string;
  kind: HoldKind;
  place_key?: string | undefined;
  until_at?: string | undefined;
  until?: { lat: number; lon: number } | undefined;
};

/** Answers after which the errand may be offered again in the same trip; any other answer (or none yet) burns it. */
const REOFFERED: CarAction[] = ["next", "later"];

const placeOf = (json: string): CarPlace | undefined => {
  try {
    const r = CarPlace.safeParse(JSON.parse(json));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
};

function alert(r: Selectable<CarAlertsTable>): AlertRow | undefined {
  const place = placeOf(r.place);
  if (!place) return undefined;
  const answer = CarAction.safeParse(r.answer);
  return {
    id: r.id,
    trip_id: r.trip_id,
    task_id: r.task_id,
    errand: r.errand,
    place,
    distance_m: r.distance_m,
    at: r.at,
    ...(answer.success ? { answer: answer.data } : {}),
    ...opt("answered_at", r.answered_at),
  };
}

const alerts = (rows: Selectable<CarAlertsTable>[]) => rows.flatMap((r) => alert(r) ?? []);

export function carAlertsRepo({ one, all, run }: Sql) {
  return {
    add(a: Omit<AlertRow, "id" | "answer" | "answered_at">): AlertRow {
      const id = newId("calr");
      run(
        qb.insertInto("car_alerts").values({
          id,
          trip_id: a.trip_id,
          task_id: a.task_id,
          errand: a.errand,
          place_key: a.place.key,
          place: JSON.stringify(a.place),
          distance_m: Math.round(a.distance_m),
          at: a.at,
        }),
      );
      return { ...a, id, distance_m: Math.round(a.distance_m) };
    },
    get(id: string): AlertRow | undefined {
      const r = one(qb.selectFrom("car_alerts").selectAll().where("id", "=", id));
      return r ? alert(r) : undefined;
    },
    /** A trip's offers, newest first. */
    ofTrip(trip: string): AlertRow[] {
      return alerts(all(qb.selectFrom("car_alerts").selectAll().where("trip_id", "=", trip).orderBy("at", "desc")));
    },
    /** Errands of the trip whose one offer went out: they are not offered again. */
    spent(trip: string): Set<string> {
      const rows = all(
        qb
          .selectFrom("car_alerts")
          .select("task_id")
          .where("trip_id", "=", trip)
          .where((eb) => eb.or([eb("answer", "is", null), eb("answer", "not in", REOFFERED)])),
      );
      return new Set(rows.map((r) => r.task_id));
    },
    /** Offers of the trip the phone has not been given yet, oldest first; they are marked given. */
    deliver(trip: string, at: string): AlertRow[] {
      const rows = alerts(
        all(
          qb
            .selectFrom("car_alerts")
            .selectAll()
            .where("trip_id", "=", trip)
            .where("delivered_at", "is", null)
            .where("answer", "is", null)
            .orderBy("at", "asc"),
        ),
      );
      if (rows.length)
        run(
          qb
            .updateTable("car_alerts")
            .set({ delivered_at: at })
            .where(
              "id",
              "in",
              rows.map((r) => r.id),
            ),
        );
      return rows;
    },
    answer(id: string, action: CarAction, at: string): void {
      run(qb.updateTable("car_alerts").set({ answer: action, answered_at: at }).where("id", "=", id));
    },
    holds(trip: string): Hold[] {
      return all(qb.selectFrom("car_holds").selectAll().where("trip_id", "=", trip)).map((r) => ({
        task_id: r.task_id,
        kind: r.kind as HoldKind,
        ...opt("place_key", r.place_key),
        ...opt("until_at", r.until_at),
        ...(r.until_lat !== null && r.until_lon !== null ? { until: { lat: r.until_lat, lon: r.until_lon } } : {}),
      }));
    },
    hold(trip: string, h: Hold, at: string): void {
      // One hold of a kind per errand, except declined places, which add up.
      if (h.kind !== "declined_place")
        run(
          qb
            .deleteFrom("car_holds")
            .where("trip_id", "=", trip)
            .where("task_id", "=", h.task_id)
            .where("kind", "=", h.kind),
        );
      run(
        qb.insertInto("car_holds").values({
          trip_id: trip,
          task_id: h.task_id,
          kind: h.kind,
          place_key: h.place_key ?? null,
          until_at: h.until_at ?? null,
          until_lat: h.until?.lat ?? null,
          until_lon: h.until?.lon ?? null,
          at,
        }),
      );
    },
  };
}
