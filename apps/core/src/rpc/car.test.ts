import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlaceProvider } from "../car/provider.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

const HERE = { lat: -34.6, lon: -58.4 };
const START = "2026-11-27T15:00:00.000Z";
const TRIP = "trip-rpc-0001";

const places: PlaceProvider = {
  id: "osm",
  async search(_area, categories) {
    return categories.includes("supermarket")
      ? [
          {
            key: "osm:node/1",
            name: "Acme Market",
            lat: HERE.lat + 0.005,
            lon: HERE.lon,
            source: "osm",
            categories: ["supermarket"],
            address: "Calle Falsa 123",
          },
        ]
      : [];
  },
};

test("car mode through the router: settings, an errand's place, a trip and its offer, answered once", async () => {
  let at = new Date(START);
  let searched = 0;
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    clock: () => at,
    carPlaces: async () => ({
      ...places,
      search: (...args) => {
        searched++;
        return places.search(...args);
      },
    }),
  });
  try {
    const { client, core } = env;
    const initial = await client.call("car.settings", {});
    assert.equal(initial.settings.enabled, false, "off by default");
    assert.equal(initial.google_key, false);
    await assert.rejects(client.call("car.configure", { source: "google" }), /key/);
    const on = await client.call("car.configure", { enabled: true, reach: "normal" });
    assert.equal(on.settings.enabled, true);

    // The agent's categories win; without any, the keywords fill them; null clears the place.
    const milk = await client.call("tasks.create", { title: "Comprar leche", kind: "errand" });
    assert.ok(milk.place?.categories.includes("supermarket"));
    const pinned = await client.call("tasks.create", {
      title: "Retirar paquete",
      kind: "errand",
      place: { categories: ["post_office"], at: { lat: 0, lon: 0, label: "Correo" } },
    });
    assert.deepEqual(pinned.place?.categories, ["post_office"]);
    const cleared = await client.call("tasks.update", { task: pinned.id, place: null });
    assert.equal(cleared.place, undefined);

    const view = await client.call("car.trip_start", { trip_id: TRIP, source: "android_auto", at: START });
    assert.equal(view.trip?.id, TRIP);
    assert.ok(view.errands.some((e) => e.task_id === milk.id));
    const send = (key: string, body: object) =>
      fetch(`${core.url}/rpc/car.position`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
    const position = { trip_id: TRIP, ...HERE, accuracy_m: 10, speed_mps: 12, heading_deg: 0, at: START };
    const missingKey = await fetch(`${core.url}/rpc/car.position`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(position),
    });
    assert.equal(missingKey.status, 400, "an effect method needs its idempotency key");
    type Answer = { result: { alerts: { id: string; task_id: string }[] } };
    // The first point only starts the search; its offer comes with the next point.
    assert.deepEqual(((await (await send("pos-1", position)).json()) as Answer).result.alerts, []);
    await waitFor(() => core.store.carAlerts.ofTrip(TRIP).length > 0, "the background offer");
    const searches = searched;
    const first = ((await (await send("pos-2", position)).json()) as Answer).result;
    assert.equal(first.alerts[0]?.task_id, milk.id);
    const again = ((await (await send("pos-2", position)).json()) as Answer).result;
    assert.equal(again.alerts[0]?.id, first.alerts[0]?.id, "a retried point gets the same answer, not a second offer");
    assert.equal(searched, searches, "and no second search");

    const offer = first.alerts[0]?.id ?? "";
    const going = await client.call("car.answer", { alert_id: offer, action: "navigate" });
    assert.equal(going.alert.answer, "navigate");
    assert.match(going.alert.navigate_url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
    const prefs = await client.call("car.places", {});
    assert.equal(prefs.places[0]?.accepted, 1);
    const avoided = await client.call("car.place_choice", { key: "osm:node/1", choice: "avoid" });
    assert.equal(avoided.place?.choice, "avoid");
    await client.call("car.answer", { alert_id: offer, action: "done" });
    assert.equal(core.store.tasks.get(milk.id)?.state, "done");

    at = new Date(Date.parse(START) + 25 * 60_000);
    const ended = await client.call("car.trip_end", { trip_id: TRIP, at: at.toISOString() });
    assert.equal(ended.ended, true);
    assert.equal((await client.call("car.trip", {})).trip, undefined);
    const preview = await client.call("car.preview", HERE);
    assert.deepEqual(
      preview.errands.map((e) => [e.task_id, e.best]),
      [[pinned.id, undefined]],
      "the parcel is left, with no pickup point near",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
