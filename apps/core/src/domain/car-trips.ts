// The phone's trips (rules/ERRANDS_ON_THE_WAY.md#trips): one row each, holding only the last point, so a restart
// keeps the trip and nothing of the route is stored.
import { CarDestination, type CarTrip, type CarTripSource } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { CarTripsTable } from "../db/schema.ts";
import { opt, qb, type Sql } from "./sql.ts";

export type TripRow = CarTrip & {
  device_id?: string | undefined;
  /** When the last offer of this trip went out: offers are spaced. */
  last_alert_at?: string | undefined;
};

export type TripPosition = { lat: number; lon: number; at: string; speed_mps?: number; heading_deg?: number };

const destinationOf = (json: string | null): CarTrip["destination"] => {
  if (!json) return undefined;
  try {
    const r = CarDestination.safeParse(JSON.parse(json));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
};

function trip(r: Selectable<CarTripsTable>): TripRow {
  const destination = destinationOf(r.destination);
  return {
    id: r.id,
    source: r.source as CarTripSource,
    started_at: r.started_at,
    ...opt("ended_at", r.ended_at),
    ...(destination ? { destination } : {}),
    ...(r.lat !== null && r.lon !== null && r.position_at
      ? {
          position: {
            lat: r.lat,
            lon: r.lon,
            at: r.position_at,
            ...(r.speed_mps !== null ? { speed_mps: r.speed_mps } : {}),
            ...(r.heading_deg !== null ? { heading_deg: r.heading_deg } : {}),
          },
        }
      : {}),
    silenced: Boolean(r.silenced),
    ...opt("device_id", r.device_id),
    ...opt("last_alert_at", r.last_alert_at),
  };
}

export function carTripsRepo({ one, all, run, tx }: Sql) {
  const repo = {
    get(id: string): TripRow | undefined {
      const r = one(qb.selectFrom("car_trips").selectAll().where("id", "=", id));
      return r ? trip(r) : undefined;
    },
    /** The trip going on now: the newest without an end. */
    active(): TripRow | undefined {
      const r = one(
        qb.selectFrom("car_trips").selectAll().where("ended_at", "is", null).orderBy("started_at", "desc").limit(1),
      );
      return r ? trip(r) : undefined;
    },
    /** Whether a phone ever reported a trip. */
    any(): boolean {
      return Boolean(one(qb.selectFrom("car_trips").select("id").limit(1)));
    },
    /**
     * Starts the trip, or updates it when the phone repeats its id (opening it again if it had ended); any other open
     * trip ends, since one car drives at a time.
     */
    start(t: {
      id: string;
      source: CarTripSource;
      at: string;
      destination?: CarTrip["destination"];
      device_id?: string | undefined;
    }): TripRow {
      return tx(() => {
        run(qb.updateTable("car_trips").set({ ended_at: t.at }).where("ended_at", "is", null).where("id", "!=", t.id));
        const destination = t.destination ? JSON.stringify(t.destination) : null;
        if (repo.get(t.id))
          run(
            qb
              .updateTable("car_trips")
              .set({
                source: t.source,
                ended_at: null,
                ...(t.destination ? { destination } : {}),
                ...(t.device_id ? { device_id: t.device_id } : {}),
              })
              .where("id", "=", t.id),
          );
        else
          run(
            qb.insertInto("car_trips").values({
              id: t.id,
              source: t.source,
              started_at: t.at,
              destination,
              device_id: t.device_id ?? null,
            }),
          );
        return repo.get(t.id) as TripRow;
      });
    },
    position(id: string, p: TripPosition): void {
      run(
        qb
          .updateTable("car_trips")
          .set({
            lat: p.lat,
            lon: p.lon,
            position_at: p.at,
            speed_mps: p.speed_mps ?? null,
            heading_deg: p.heading_deg ?? null,
          })
          .where("id", "=", id),
      );
    },
    alerted(id: string, at: string): void {
      run(qb.updateTable("car_trips").set({ last_alert_at: at }).where("id", "=", id));
    },
    silence(id: string): void {
      run(qb.updateTable("car_trips").set({ silenced: 1 }).where("id", "=", id));
    },
    /** Ends it; false when it was not going on. */
    end(id: string, at: string): boolean {
      return (
        run(qb.updateTable("car_trips").set({ ended_at: at }).where("id", "=", id).where("ended_at", "is", null)) > 0
      );
    },
    /** Open trips whose last sign of life (last point, or start) is before `before`. */
    idle(before: string): TripRow[] {
      return all(qb.selectFrom("car_trips").selectAll().where("ended_at", "is", null))
        .map(trip)
        .filter((t) => (t.position?.at ?? t.started_at) < before);
    },
  };
  return repo;
}
