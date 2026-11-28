// Each trip's candidates per errand, kept in memory. A search can take most of a minute on a public Overpass, so a
// position never waits for one: it reads what is here and warms the area ahead in the background, one warm per trip
// at a time. A failed search leaves what the errand had (or nothing: no offer) and is tried again on the next point.
import type { CarReach, ErrandPlace } from "@apx/protocol";
import { distanceM, type Point } from "./geo.ts";
import { type MatchErrand, REACH_M } from "./matcher.ts";
import type { FoundPlace, PlaceProvider } from "./provider.ts";

/** Moved this far from where it last warmed, a trip warms again around the new point. */
const WARM_MOVE_M = 1500;
/** How long one warm's searches may take, all together (AGENTS.md rule 9). */
/** One warm's whole budget, and one Overpass request's: a busy instance gets cut and the next one tried. */
const SEARCH_DEADLINE_MS = 60_000;
export const REQUEST_DEADLINE_MS = 25_000;

export type OpenErrand = { task_id: string; title: string; place: ErrandPlace | undefined };

type Entry = { sig: string; places: FoundPlace[] };
type Plan = { at?: Point; byTask: Map<string, Entry>; warming?: Promise<WarmResult>; abort?: AbortController };
export type WarmResult = { searched: number; failed: number };

const signature = (e: OpenErrand) => JSON.stringify(e.place ?? null);

/** A fixed place is the errand's only candidate, with no search. */
const pinned = (e: OpenErrand): FoundPlace | undefined => {
  const at = e.place?.at;
  return at
    ? {
        key: `pinned:${e.task_id}`,
        name: at.label ?? e.title,
        lat: at.lat,
        lon: at.lon,
        source: "pinned",
        categories: e.place?.categories ?? [],
      }
    : undefined;
};

export function createPlans(o: {
  provider: () => Promise<PlaceProvider | undefined>;
  now: () => Date;
  onError?: (err: unknown) => void;
}) {
  const plans = new Map<string, Plan>();
  const running = new Set<Promise<WarmResult>>();
  const planOf = (key: string) => {
    let plan = plans.get(key);
    if (!plan) {
      plan = { byTask: new Map() };
      plans.set(key, plan);
    }
    return plan;
  };

  async function search(
    e: OpenErrand,
    at: Point,
    reach: CarReach,
    signal: AbortSignal,
  ): Promise<FoundPlace[] | undefined> {
    if (signal.aborted) return undefined;
    const fixed = pinned(e);
    if (fixed) return [fixed];
    const categories = e.place?.categories ?? [];
    if (!categories.length) return [];
    const provider = await o.provider();
    if (!provider || signal.aborted) return undefined;
    const radius_m = 1.5 * (e.place?.radius_m ?? REACH_M[reach]);
    try {
      return await provider.search({ lat: at.lat, lon: at.lon, radius_m }, categories, o.now(), signal);
    } catch (err) {
      if (!signal.aborted) o.onError?.(err);
      return undefined;
    }
  }

  const asMatch = (plan: Plan | undefined, errands: readonly OpenErrand[]): MatchErrand[] =>
    errands.map((e) => {
      const entry = plan?.byTask.get(e.task_id);
      return { task_id: e.task_id, place: e.place, candidates: entry?.sig === signature(e) ? entry.places : [] };
    });

  /** Whether the plan lacks these errands around `at`: far from where it warmed, or an errand new or changed. */
  const stale = (plan: Plan | undefined, at: Point, errands: readonly OpenErrand[]) =>
    !plan?.at ||
    distanceM(plan.at, at) > WARM_MOVE_M ||
    errands.some((e) => plan.byTask.get(e.task_id)?.sig !== signature(e));

  async function warmNow(plan: Plan, at: Point, errands: readonly OpenErrand[], reach: CarReach): Promise<WarmResult> {
    const moved = !plan.at || distanceM(plan.at, at) > WARM_MOVE_M;
    const wanted = moved ? errands : errands.filter((e) => plan.byTask.get(e.task_id)?.sig !== signature(e));
    const center = moved ? { lat: at.lat, lon: at.lon } : (plan.at as Point);
    const signal = AbortSignal.any([
      AbortSignal.timeout(SEARCH_DEADLINE_MS),
      plan.abort?.signal ?? AbortSignal.abort(),
    ]);
    const found = await Promise.all(wanted.map((e) => search(e, center, reach, signal)));
    if (signal.aborted) return { searched: wanted.length, failed: wanted.length };
    let failed = 0;
    wanted.forEach((e, i) => {
      const places = found[i];
      // A failed search keeps what the errand had from the last warm, if it still fits.
      if (places) plan.byTask.set(e.task_id, { sig: signature(e), places });
      else failed++;
    });
    if (moved && failed < wanted.length) plan.at = center;
    return { searched: wanted.length, failed };
  }

  return {
    /** What the plan has for these errands now, without searching. */
    cached: (key: string, errands: readonly OpenErrand[]): MatchErrand[] => asMatch(plans.get(key), errands),
    stale: (key: string, at: Point, errands: readonly OpenErrand[]) => stale(plans.get(key), at, errands),
    /**
     * Searches what the plan lacks around `at`; while a warm of this key runs, another call joins it instead of
     * starting a second one.
     */
    warm(key: string, at: Point, errands: readonly OpenErrand[], reach: CarReach): Promise<WarmResult> {
      const plan = planOf(key);
      if (plan.warming) return plan.warming;
      plan.abort = new AbortController();
      const run = warmNow(plan, at, errands, reach).finally(() => {
        plan.warming = undefined;
        running.delete(run);
      });
      running.add(run);
      plan.warming = run;
      return run;
    },
    /** Every warm still running, settled (tests and a closing core wait on it). */
    async idle(): Promise<void> {
      await Promise.allSettled([...running]);
    },
    drop(key: string): void {
      plans.get(key)?.abort?.abort();
      plans.delete(key);
    },
    /** Forgets every trip's plan but these. */
    keep(keys: ReadonlySet<string>): void {
      for (const [k, plan] of plans)
        if (!keys.has(k)) {
          plan.abort?.abort();
          plans.delete(k);
        }
    },
  };
}

export type Plans = ReturnType<typeof createPlans>;
