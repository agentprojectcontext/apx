import assert from "node:assert/strict";
import { test } from "node:test";
import { googleProvider } from "./google.ts";
import { osmProvider } from "./osm.ts";
import { createPlans } from "./plan.ts";
import type { PlaceProvider } from "./provider.ts";

const at = { lat: 1, lon: 2 };
const now = () => new Date("2026-11-01T00:00:00Z");
const errands = [
  {
    task_id: "test-task",
    title: "Shopping",
    place: { categories: ["supermarket", "pharmacy"] as ("supermarket" | "pharmacy")[] },
  },
];

for (const source of ["google", "osm"] as const) {
  test(`${source} trip cancellation prevents the next category, queued batch and fallback request`, async () => {
    const first = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetch = async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal);
      if (signals.length === 1) {
        started.resolve();
        return first.promise;
      }
      return Response.json({ places: [], elements: [] });
    };
    const provider: PlaceProvider =
      source === "google"
        ? googleProvider({ key: "test-key", fetch, now })
        : osmProvider({
            fetch,
            now,
            minGapMs: 0,
            batchSize: 1,
            endpoints: ["https://places.example/one", "https://places.example/two"],
            cache: { freshTiles: () => new Set(), putTile: () => {}, placesIn: () => [] },
          });
    const plans = createPlans({ provider: async () => provider, now });
    const warm = plans.warm("trip-one", at, errands, "normal");
    await started.promise;
    const queued = source === "osm" ? plans.warm("trip-two", { lat: 3, lon: 4 }, errands, "normal") : Promise.resolve();
    plans.keep(new Set());
    const aborted = signals[0]?.aborted;
    first.resolve(Response.json({ places: [], elements: [] }));
    await Promise.all([warm, queued, plans.idle()]);
    assert.equal(aborted, true, "revocation aborts the active network request");
    assert.equal(signals.length, 1, "no subsequent coordinate-bearing request starts");
    assert.deepEqual(plans.cached("trip-one", errands)[0]?.candidates, []);
  });
}

test("a removed plan never starts a provider which was still being acquired", async () => {
  const provider = Promise.withResolvers<PlaceProvider>();
  let searched = 0;
  const plans = createPlans({ provider: () => provider.promise, now });
  const warm = plans.warm("trip", at, errands, "normal");
  plans.drop("trip");
  provider.resolve({
    id: "osm",
    search: async () => {
      searched++;
      return [];
    },
  });
  await warm;
  assert.equal(searched, 0);
});
