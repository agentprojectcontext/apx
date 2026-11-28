// Errands on the way (DECISIONS.md#d-284, rules/ERRANDS_ON_THE_WAY.md): the phone tells the core when the owner drives
// and where they are; the core finds a place for each open errand near the way and offers it on the car, the phone and
// the panel. Everything is off until the owner turns it on.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { schemaFields } from "./schema-fields.ts";

/**
 * Where an errand can be done. A closed list so that "papas fritas" and "leche" land on the same supermarket search
 * whichever agent wrote the errand; the core holds each one's search terms (apps/core/src/car/categories.ts).
 */
export const ErrandCategory = z.enum([
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
]);
export type ErrandCategory = z.infer<typeof ErrandCategory>;

export const LatLon = z.object(
  schemaFields({
    lat: () => z.number().min(-90).max(90),
    lon: () => z.number().min(-180).max(180),
  }),
);
export type LatLon = z.infer<typeof LatLon>;

/**
 * Where an errand is done: the kinds of shop that sell it (best first), an optional brand or chain the owner asked
 * for, or one fixed place (pick up at the post office on X street), which skips the search.
 */
export const ErrandPlace = z
  .object(
    schemaFields({
      categories: () => z.array(ErrandCategory).max(4).default([]),
      brand: () => z.string().trim().min(1).max(60).optional(),
      at: () =>
        LatLon.extend({ label: z.string().trim().min(1).max(120).optional() })
          .strict()
          .optional(),
      /** How close the owner must pass for it to count; unset: the owner's setting. */
      radius_m: () => z.number().int().min(100).max(20_000).optional(),
    }),
  )
  .strict();
export type ErrandPlace = z.infer<typeof ErrandPlace>;

/** Where place searches go: OpenStreetMap needs no key; Google adds open-now and better coverage with the owner's key. */
export const PlaceSource = z.enum(["osm", "google"]);
export type PlaceSource = z.infer<typeof PlaceSource>;

/** How far ahead the owner wants to hear about a place: near (city blocks), normal, far (a road trip). */
export const CarReach = z.enum(["near", "normal", "far"]);
export type CarReach = z.infer<typeof CarReach>;

export const CarSettings = z
  .object(
    schemaFields({
      enabled: () => z.boolean(),
      reach: () => CarReach,
      source: () => PlaceSource,
      /** Also tell the owner on their chat channel (Telegram, WhatsApp…), not only on the phone and the car. */
      tell_in_chat: () => z.boolean(),
      /** While driving, the super-agent answers in short spoken replies. */
      voice_while_driving: () => z.boolean(),
    }),
  )
  .strict();
export type CarSettings = z.infer<typeof CarSettings>;

export const CarStatus = z.object(
  schemaFields({
    settings: () => CarSettings,
    /** A Google key is saved for place searches. */
    google_key: () => z.boolean(),
    /** A phone in car mode has talked to the core. */
    phone: () => z.boolean(),
    trip: () => CarTrip.optional(),
  }),
);
export type CarStatus = z.infer<typeof CarStatus>;

/** A place found for an errand. `key` is `<source>:<id>` (osm:node/123, google:ChIJ…, pinned:<task id>). */
export const CarPlace = z.object(
  schemaFields({
    key: () => z.string(),
    name: () => z.string(),
    lat: () => z.number(),
    lon: () => z.number(),
    address: () => z.string().optional(),
    category: () => ErrandCategory.optional(),
    /** `open`/`closed` when the source knows its hours now; unset: unknown. */
    open: () => z.enum(["open", "closed"]).optional(),
    /** Closes within the hour. */
    closes_soon: () => z.boolean().optional(),
    rating: () => z.number().optional(),
    /** The owner chose it before. */
    preferred: () => z.boolean().optional(),
    source: () => z.enum(["osm", "google", "pinned"]),
  }),
);
export type CarPlace = z.infer<typeof CarPlace>;

/**
 * What the owner can answer to an offer. `navigate` and `add_stop` mean "I'm going" (the phone opens Maps);
 * `next` asks for another place for the same errand; `later` waits a while in this trip; `skip` leaves the errand
 * for this trip; `silence` stops every offer until the car is connected again; `done` closes the errand.
 */
export const CarAction = z.enum(["navigate", "add_stop", "next", "later", "skip", "silence", "done"]);
export type CarAction = z.infer<typeof CarAction>;

/** One offer: an errand and the place for it, with the words to show and to say. */
export const CarAlert = z.object(
  schemaFields({
    id: () => z.string(),
    trip_id: () => z.string(),
    task_id: () => z.string(),
    errand: () => z.string(),
    place: () => CarPlace,
    distance_m: () => z.number().int().nonnegative(),
    /** "1.4 km", for a chip. */
    distance_label: () => z.string(),
    title: () => z.string(),
    /** Plain words for a voice to read: no emoji, units spelled out. */
    spoken: () => z.string(),
    actions: () => z.array(CarAction),
    /** Google Maps links: go there, and go there as a stop on the way to the current destination. */
    navigate_url: () => z.string(),
    add_stop_url: () => z.string().optional(),
    at: () => z.string(),
    answer: () => CarAction.optional(),
    answered_at: () => z.string().optional(),
  }),
);
export type CarAlert = z.infer<typeof CarAlert>;

/** An open errand as the car lists it: the best place found so far, if any. */
export const CarErrand = z.object(
  schemaFields({
    task_id: () => z.string(),
    title: () => z.string(),
    place: () => ErrandPlace.optional(),
    best: () => CarPlace.optional(),
    distance_m: () => z.number().int().nonnegative().optional(),
    /** Left for this trip (skip) or waiting (later). */
    held: () => z.enum(["skip", "later"]).optional(),
  }),
);
export type CarErrand = z.infer<typeof CarErrand>;

export const CarTripSource = z.enum(["android_auto", "maps", "manual"]);
export type CarTripSource = z.infer<typeof CarTripSource>;

export const CarDestination = LatLon.partial()
  .extend({ label: z.string().trim().min(1).max(160).optional() })
  .strict();
export type CarDestination = z.infer<typeof CarDestination>;

export const CarTrip = z.object(
  schemaFields({
    id: () => z.string(),
    source: () => CarTripSource,
    started_at: () => z.string(),
    ended_at: () => z.string().optional(),
    destination: () => CarDestination.optional(),
    position: () =>
      LatLon.extend({ at: z.string(), speed_mps: z.number().optional(), heading_deg: z.number().optional() }).optional(),
    /** The owner asked for no more offers this trip. */
    silenced: () => z.boolean(),
  }),
);
export type CarTrip = z.infer<typeof CarTrip>;

export const CarTripView = z.object(
  schemaFields({
    trip: () => CarTrip.optional(),
    /** Offers waiting for an answer, newest first. */
    alerts: () => z.array(CarAlert),
    errands: () => z.array(CarErrand),
  }),
);
export type CarTripView = z.infer<typeof CarTripView>;

/** A place the owner went to (or turned down) for errands, which ranks it up (or down) next time. */
export const PreferredPlace = z.object(
  schemaFields({
    key: () => z.string(),
    name: () => z.string(),
    lat: () => z.number(),
    lon: () => z.number(),
    categories: () => z.array(ErrandCategory),
    accepted: () => z.number().int().nonnegative(),
    declined: () => z.number().int().nonnegative(),
    done: () => z.number().int().nonnegative(),
    /** The owner said: always this one (prefer) or never (avoid); unset: learned from answers. */
    choice: () => z.enum(["prefer", "avoid"]).optional(),
    last_at: () => z.string(),
  }),
);
export type PreferredPlace = z.infer<typeof PreferredPlace>;

const Position = z
  .object({
    trip_id: z.string().min(8).max(64),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    accuracy_m: z.number().nonnegative().max(100_000).optional(),
    speed_mps: z.number().min(0).max(120).optional(),
    heading_deg: z.number().min(0).max(360).optional(),
    at: z.string().datetime(),
  })
  .strict();

export const carMethods = {
  "car.settings": deferMethod({
    params: () => z.object({}).strict(),
    result: () => CarStatus,
    effect: false,
    access: "human",
  }),
  "car.configure": deferMethod({
    params: () =>
      CarSettings.partial()
        .extend({
          /** A Google Maps Platform key (Places API New) to save; empty removes it. */
          google_key: z.string().max(200).optional(),
        })
        .strict(),
    result: () => CarStatus,
    effect: true,
    access: "human",
  }),
  /** The phone: the car connected (or Maps started a route). Repeating a trip id only updates it. */
  "car.trip_start": deferMethod({
    params: () =>
      z
        .object({
          trip_id: z.string().min(8).max(64),
          source: CarTripSource,
          destination: CarDestination.optional(),
          at: z.string().datetime(),
        })
        .strict(),
    result: () => CarTripView,
    effect: true,
    access: "human",
  }),
  /** The phone: where it is now. The answer carries the new offers, so a phone that cannot hold a socket still gets them. */
  "car.position": deferMethod({
    params: () => Position,
    result: () => z.object({ alerts: z.array(CarAlert), active: z.boolean() }),
    effect: true,
    access: "human",
  }),
  "car.trip_end": deferMethod({
    params: () => z.object({ trip_id: z.string().min(8).max(64), at: z.string().datetime() }).strict(),
    result: () => z.object({ ended: z.boolean() }),
    effect: true,
    access: "human",
  }),
  /** The current trip, its waiting offers and the open errands with their best place; read only, it never offers. */
  "car.trip": deferMethod({
    params: () => z.object({}).strict(),
    result: () => CarTripView,
    effect: false,
    access: "human",
  }),
  /** The owner answered an offer, on the car, the phone, the panel or a chat button. */
  "car.answer": deferMethod({
    params: () => z.object({ alert_id: z.string(), action: CarAction }).strict(),
    result: () => z.object({ alert: CarAlert, next: CarAlert.optional() }),
    effect: true,
    access: "human",
  }),
  /** An errand from the car's list, without an offer (done, skip for this trip, go now). */
  "car.errand": deferMethod({
    params: () =>
      z.object({ task_id: z.string(), action: z.enum(["navigate", "skip", "done"]) }).strict(),
    result: () => z.object({ errand: CarErrand.optional(), navigate_url: z.string().optional() }),
    effect: true,
    access: "human",
  }),
  "car.places": deferMethod({
    params: () => z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict(),
    result: () => z.object({ places: z.array(PreferredPlace) }),
    effect: false,
    access: "human",
  }),
  "car.place_choice": deferMethod({
    params: () => z.object({ key: z.string(), choice: z.enum(["prefer", "avoid", "none", "forget"]) }).strict(),
    result: () => z.object({ place: PreferredPlace.optional() }),
    effect: true,
    access: "human",
  }),
  /** Try the search where the owner is (or a point) without a trip: what each open errand would be offered. */
  "car.preview": deferMethod({
    params: () => LatLon.extend({ heading_deg: z.number().min(0).max(360).optional() }).strict(),
    result: () => z.object({ errands: z.array(CarErrand) }),
    effect: false,
    access: "human",
  }),
} as const;
