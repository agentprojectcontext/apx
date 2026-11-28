// Errands on the way (DECISIONS.md#d-286, rules/ERRANDS_ON_THE_WAY.md): trips from the phone, one offer per position at
// most, the owner's answers. Everything is in the store, so a restart keeps the trip; only the search plan is in memory.
import type {
  CarAction,
  CarAlert,
  CarDestination,
  CarErrand,
  CarSettings,
  CarStatus,
  CarTripSource,
  CarTripView,
  PlaceSource,
  PreferredPlace,
} from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { AlertRow, Hold } from "../domain/car-alerts.ts";
import type { TripRow } from "../domain/car-trips.ts";
import { phonePrivacy, revokeTripConsent, tripPrivacyRevision } from "../domain/phone-privacy.ts";
import type { Store } from "../domain/store.ts";
import type { BackgroundCheck } from "../engine/background.ts";
import { badRequest, unavailable } from "../errors.ts";
import type { Secrets } from "../secrets.ts";
import { type AnswerEnv, answerAlert, errandAction } from "./answers.ts";
import { placeOfTask } from "./errands.ts";
import { googleProvider } from "./google.ts";
import { type MatchContext, pick, quiet, WORST_ACCURACY_M } from "./matcher.ts";
import { osmProvider } from "./osm.ts";
import { createPhones } from "./phones.ts";
import { createPlans, type OpenErrand, REQUEST_DEADLINE_MS } from "./plan.ts";
import type { Fetch, PlaceProvider } from "./provider.ts";
import { alertView, errandViews, lockedPlaces, publicTrip, shownPlace } from "./view.ts";
import type { Lang } from "./wording.ts";

/** Where the owner's Google key is kept (by reference only, AGENTS.md rule 11). */
const GOOGLE_KEY_SECRET = "car-google-key";
const GOOGLE_REF = `secret://${GOOGLE_KEY_SECRET}`;
/** A trip with no point for this long ended without the phone saying so. */
export const IDLE_TRIP_MS = 20 * 60_000;

export type CarDeps = {
  store: Store;
  bus: Bus;
  secrets: Pick<Secrets, "resolve" | "has" | "set">;
  now?: () => Date;
  /** The place source in use; tests pass a fake. Unset: OpenStreetMap, or Google with the owner's key. */
  provider?: (source: PlaceSource) => Promise<PlaceProvider | undefined>;
  fetch?: Fetch;
  onError?: (err: unknown) => void;
  /** A copy of a new offer on the owner's chat channel, when they asked for it (`tell_in_chat`). */
  tellOwner?: (alert: CarAlert, lang: Lang) => void;
};

type PositionIn = {
  trip_id: string;
  consent_revision?: string | undefined;
  lat: number;
  lon: number;
  accuracy_m?: number | undefined;
  speed_mps?: number | undefined;
  heading_deg?: number | undefined;
  at: string;
};

export function createCar(d: CarDeps) {
  const { store, bus } = d;
  const now = d.now ?? (() => new Date());
  const lang = (): Lang => (store.settings.get("owner_language") === "en" ? "en" : "es");
  const settings = () => store.settings.read("car");
  const fetcher: Fetch = d.fetch ?? ((url, init) => fetch(url, init));

  let osm: PlaceProvider | undefined;
  let google: { key: string; provider: PlaceProvider } | undefined;
  const defaultProvider = async (source: PlaceSource): Promise<PlaceProvider | undefined> => {
    if (source === "osm") {
      osm ??= osmProvider({ cache: store.carPlaces, fetch: fetcher, now, deadlineMs: REQUEST_DEADLINE_MS });
      return osm;
    }
    // Google without a key offers nothing: never a guess from another source.
    const key = d.secrets.resolve(GOOGLE_REF);
    if (!key) return undefined;
    if (google?.key !== key) google = { key, provider: googleProvider({ key, fetch: fetcher, language: lang(), now }) };
    return google.provider;
  };
  const provider = () => (d.provider ?? defaultProvider)(settings().source);
  const plans = createPlans({ provider, now, ...(d.onError ? { onError: d.onError } : {}) });

  const openErrands = (): OpenErrand[] =>
    store.tasks
      .list({ state: "open", limit: 200 })
      .filter((t) => t.kind === "errand" && !t.proposed)
      .map((t) => ({ task_id: t.id, title: t.title, place: placeOfTask(t) }));
  const errandOf = (task_id: string) => openErrands().find((e) => e.task_id === task_id);

  const context = (trip: TripRow, at = trip.position): MatchContext | undefined =>
    at && {
      position: at,
      reach: settings().reach,
      holds: store.carAlerts.holds(trip.id),
      prefs: store.carPrefs.of(plans.cached(trip.id, openErrands()).flatMap((e) => e.candidates.map((c) => c.key))),
      avoided: store.carPrefs.avoided(),
      now: now(),
    };

  const view = (a: AlertRow) => alertView(a, store.carTrips.get(a.trip_id), lang());
  const changed = (alert?: CarAlert) => bus.emit({ type: "car.updated", ...(alert ? { alert } : {}) });
  const phones = createPhones(store, now, () => changed());

  const tripView = (): CarTripView => {
    const trip = store.carTrips.active();
    const errands = openErrands();
    if (!trip) return { alerts: [], errands: errandViews(errands, [], undefined, new Map()) };
    const alerts = store.carAlerts.ofTrip(trip.id);
    const holds = store.carAlerts.holds(trip.id);
    return {
      trip: publicTrip(trip),
      // An errand closed elsewhere (the panel, an agent) no longer waits for an answer.
      alerts: alerts
        .filter((a) => !a.answer && errands.some((e) => e.task_id === a.task_id))
        .map((a) => alertView(a, trip, lang())),
      errands: errandViews(errands, plans.cached(trip.id, errands), context(trip), lockedPlaces(holds, alerts)),
    };
  };

  const bestFor = (trip: TripRow, task_id: string): CarErrand | undefined => {
    const e = errandOf(task_id);
    if (!e) return undefined;
    const holds = store.carAlerts.holds(trip.id);
    return errandViews(
      [e],
      plans.cached(trip.id, [e]),
      context(trip),
      lockedPlaces(holds, store.carAlerts.ofTrip(trip.id)),
    )[0];
  };

  const env: AnswerEnv = { store, plans, now, errand: errandOf, context, view, changed };

  /** Errands the trip may still offer: open, not offered yet, not left for the trip nor going somewhere. */
  const offerable = (spent: ReadonlySet<string>, holds: readonly Hold[]) =>
    openErrands().filter(
      (e) =>
        !spent.has(e.task_id) &&
        !holds.some((h) => h.task_id === e.task_id && (h.kind === "skip" || h.kind === "lock")),
    );

  /** Matches the trip at its last point against what its plan has, and makes and tells the one offer, if any. */
  function matchTrip(tripId: string): CarAlert | undefined {
    const trip = store.carTrips.get(tripId);
    const at = trip?.position;
    if (!settings().enabled || !phonePrivacy(store).trips || !trip || trip.ended_at || !at) return undefined;
    if (quiet({ silenced: trip.silenced, last_alert_at: trip.last_alert_at, now: now() })) return undefined;
    const spent = store.carAlerts.spent(trip.id);
    const holds = store.carAlerts.holds(trip.id);
    const errands = offerable(spent, holds);
    if (!errands.length) return undefined;
    const matched = plans.cached(trip.id, errands);
    const ctx: MatchContext = {
      position: at,
      reach: settings().reach,
      holds,
      prefs: store.carPrefs.of(matched.flatMap((e) => e.candidates.map((c) => c.key))),
      avoided: store.carPrefs.avoided(),
      now: now(),
    };
    const best = pick(matched, spent, ctx);
    const errand = best && errands.find((e) => e.task_id === best.task_id);
    if (!best || !errand) return undefined;
    const pref = ctx.prefs.get(best.place.key);
    const stamp = now().toISOString();
    const row = store.tx(() => {
      const added = store.carAlerts.add({
        trip_id: trip.id,
        task_id: best.task_id,
        errand: errand.title,
        place: shownPlace(best.place, pref?.choice === "prefer" || (pref?.accepted ?? 0) > 0),
        distance_m: best.distance_m,
        at: stamp,
      });
      store.carTrips.alerted(trip.id, stamp);
      return added;
    });
    const alert = alertView(row, store.carTrips.get(trip.id), lang());
    changed(alert);
    if (settings().tell_in_chat) d.tellOwner?.(alert, lang());
    return alert;
  }

  /**
   * Searches the area ahead in the background when the plan lacks it; a position never waits for a search (a public
   * Overpass can take most of a minute). When it ends, the trip is matched once more at its latest point.
   */
  function warmAhead(tripId: string): void {
    const trip = store.carTrips.get(tripId);
    const at = trip?.position;
    if (!trip || !at || trip.ended_at || trip.silenced) return;
    const errands = offerable(store.carAlerts.spent(trip.id), store.carAlerts.holds(trip.id));
    if (!errands.length || !plans.stale(trip.id, at, errands)) return;
    plans
      .warm(trip.id, at, errands, settings().reach)
      .then(() => matchTrip(trip.id))
      .catch((err: unknown) => d.onError?.(err));
  }

  function positionAt(p: PositionIn): { alerts: CarAlert[]; active: boolean } {
    let trip = store.carTrips.get(p.trip_id);
    const revision = tripPrivacyRevision(store);
    const renewable =
      trip?.ended_at &&
      trip.device_id &&
      !store.carTrips.active() &&
      store.settings.get(`car_idle:${trip.id}`) === "1" &&
      store.settings.get(`car_revoked:${trip.id}`) !== "1";
    if (
      !settings().enabled ||
      !phonePrivacy(store).trips ||
      !trip ||
      (trip.ended_at && !renewable) ||
      (p.consent_revision ?? "initial") !== revision ||
      (store.settings.get(`car_consent:${trip.id}`) ?? "initial") !== revision ||
      !phones.allows(trip.device_id) ||
      (store.settings.get(`car_trip_phone_consent:${trip.id}`) ?? "initial") !== phones.revision(trip.device_id)
    )
      return { alerts: [], active: false };
    const at = now().toISOString();
    if (renewable) {
      trip = store.carTrips.start({
        id: trip.id,
        source: trip.source,
        at,
        ...(trip.device_id ? { device_id: trip.device_id } : {}),
      });
      store.settings.set(`car_idle:${trip.id}`, "0");
    }
    // A bad fix is neither kept nor searched around; offers already made still reach the phone.
    if ((p.accuracy_m ?? 0) <= WORST_ACCURACY_M) {
      store.carTrips.position(trip.id, {
        lat: p.lat,
        lon: p.lon,
        // A phone clock ahead of the core's never keeps a trip alive.
        at: p.at < at ? p.at : at,
        ...(p.speed_mps !== undefined ? { speed_mps: p.speed_mps } : {}),
        ...(p.heading_deg !== undefined ? { heading_deg: p.heading_deg } : {}),
      });
      matchTrip(trip.id);
      warmAhead(trip.id);
    }
    // What the phone has not been given yet: this point's offer, and any a background search made since its last one.
    const current = store.carTrips.get(trip.id);
    const alerts = store.carAlerts.deliver(trip.id, at).map((a) => alertView(a, current, lang()));
    return { alerts, active: true };
  }

  const status = (deviceId?: string): CarStatus => {
    const trip = store.carTrips.active();
    const thisPhone = phones.thisPhone(deviceId);
    return {
      settings: settings(),
      google_key: d.secrets.has(GOOGLE_REF),
      phone: store.carTrips.any(),
      ...(trip ? { trip: publicTrip(trip) } : {}),
      ...(thisPhone !== undefined ? { this_phone: thisPhone } : {}),
    };
  };

  return {
    status,
    configure(patch: Partial<CarSettings> & { google_key?: string | undefined }): CarStatus {
      const { google_key, ...rest } = patch;
      if (google_key !== undefined) d.secrets.set(GOOGLE_KEY_SECRET, google_key.trim() || null);
      const next = { ...settings(), ...rest };
      if (
        next.source === "google" &&
        !d.secrets.has(GOOGLE_REF) &&
        !(patch.enabled === false && patch.source === undefined)
      )
        throw badRequest("Google needs its key first; OpenStreetMap needs none");
      if (!next.enabled && settings().enabled) revokeTripConsent(store);
      store.settings.write("car", next);
      if (!next.enabled) {
        const trip = store.carTrips.active();
        if (trip) {
          store.settings.set(`car_revoked:${trip.id}`, "1");
          store.carTrips.end(trip.id, now().toISOString());
        }
        plans.keep(new Set());
      }
      changed();
      return status();
    },
    tripStart(p: {
      trip_id: string;
      source: CarTripSource;
      at: string;
      destination?: CarDestination | undefined;
      device_id?: string | undefined;
      consent_revision?: string | undefined;
    }): CarTripView {
      const revision = tripPrivacyRevision(store);
      const previous = store.carTrips.get(p.trip_id);
      const active = store.carTrips.active();
      if (
        !settings().enabled ||
        !phonePrivacy(store).trips ||
        (p.consent_revision ?? "initial") !== revision ||
        (previous && (store.settings.get(`car_consent:${p.trip_id}`) ?? "initial") !== revision) ||
        store.settings.get(`car_revoked:${p.trip_id}`) === "1" ||
        (previous?.ended_at && (store.settings.get(`car_idle:${p.trip_id}`) !== "1" || active !== undefined)) ||
        (previous && previous.device_id !== p.device_id) ||
        (previous &&
          (store.settings.get(`car_trip_phone_consent:${p.trip_id}`) ?? "initial") !== phones.revision(p.device_id)) ||
        !phones.allows(p.device_id)
      )
        return { alerts: [], errands: [] };
      store.settings.set(`car_consent:${p.trip_id}`, revision);
      store.settings.set(`car_trip_phone_consent:${p.trip_id}`, phones.revision(p.device_id));
      const trip = store.carTrips.start({
        id: p.trip_id,
        source: p.source,
        at: p.at,
        ...(p.destination ? { destination: p.destination } : {}),
        ...(p.device_id ? { device_id: p.device_id } : {}),
      });
      store.settings.set(`car_idle:${trip.id}`, "0");
      plans.keep(new Set([trip.id]));
      // A trip opened again (a restart, the phone back from a tunnel) warms where it last was.
      warmAhead(trip.id);
      changed();
      return tripView();
    },
    position: positionAt,
    tripEnd(trip_id: string, at: string): { ended: boolean } {
      store.settings.set(`car_idle:${trip_id}`, "0");
      const ended = store.carTrips.end(trip_id, at);
      plans.drop(trip_id);
      if (ended) changed();
      return { ended };
    },
    trip: tripView,
    phones: () => phones.list(),
    phone: phones.set,
    answer: (alert_id: string, action: CarAction) => answerAlert(env, alert_id, action),
    errand: (task_id: string, action: "navigate" | "skip" | "done") =>
      errandAction(env, store.carTrips.active(), task_id, action, bestFor),
    places: (limit: number): PreferredPlace[] => store.carPrefs.list(limit, now().toISOString()),
    placeChoice(key: string, choice: "prefer" | "avoid" | "none" | "forget"): { place?: PreferredPlace } {
      if (choice === "forget") {
        store.carPrefs.forget(key);
        return {};
      }
      const place = store.carPrefs.choose(key, choice === "none" ? null : choice);
      return place ? { place } : {};
    },
    /** What each open errand would be offered at a point, without a trip and without offering. */
    async preview(p: { lat: number; lon: number; heading_deg?: number | undefined }): Promise<CarErrand[]> {
      const errands = openErrands();
      const key = `preview:${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
      // The owner waits for this one, so it may take as long as a search does, and says so when it fails.
      const result = await plans.warm(key, p, errands, settings().reach);
      const matched = plans.cached(key, errands);
      plans.drop(key);
      if (result.searched && result.failed === result.searched)
        throw unavailable("The place search did not answer in time. Try again in a minute.");
      const ctx: MatchContext = {
        position: { lat: p.lat, lon: p.lon, ...(p.heading_deg !== undefined ? { heading_deg: p.heading_deg } : {}) },
        reach: settings().reach,
        holds: [],
        prefs: store.carPrefs.of(matched.flatMap((e) => e.candidates.map((c) => c.key))),
        avoided: store.carPrefs.avoided(),
        now: now(),
      };
      return errandViews(errands, matched, ctx, new Map());
    },
    /** Every background search settled (tests, and a core closing). */
    idle: () => plans.idle(),
    /** Ends trips whose phone went quiet (DECISIONS.md#d-171), only while car mode is on. */
    check: {
      id: "car-trips",
      everyMs: 60_000,
      run: (at: Date) => {
        if (!settings().enabled || !phonePrivacy(store).trips) return;
        const idle = store.carTrips.idle(new Date(at.getTime() - IDLE_TRIP_MS).toISOString());
        for (const t of idle) {
          store.settings.set(`car_idle:${t.id}`, "1");
          store.carTrips.end(t.id, at.toISOString());
          plans.drop(t.id);
        }
        if (idle.length) changed();
      },
    } satisfies BackgroundCheck,
  };
}

export type Car = ReturnType<typeof createCar>;
