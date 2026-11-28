import assert from "node:assert/strict";
import { test } from "node:test";
import { addStopUrl, distanceLabel, navigateUrl, offerSpoken, offerTitle, spokenDistance } from "./wording.ts";

test("distances read as a person says them, with no units abbreviated aloud", () => {
  assert.equal(distanceLabel(870, "es"), "900 m");
  assert.equal(distanceLabel(1420, "es"), "1,4 km");
  assert.equal(distanceLabel(1420, "en"), "1.4 km");
  assert.equal(spokenDistance(40, "es"), "a 100 metros");
  assert.equal(spokenDistance(870, "es"), "a 900 metros");
  assert.equal(spokenDistance(1010, "es"), "a un kilómetro");
  assert.equal(spokenDistance(1480, "es"), "a un kilómetro y medio");
  assert.equal(spokenDistance(2310, "es"), "a 2,3 kilómetros");
  assert.equal(spokenDistance(1500, "en"), "a kilometer and a half away");
  assert.equal(spokenDistance(2310, "en"), "2.3 kilometers away");
});

test("an offer leads with the errand, then the place, the distance and the street", () => {
  const place = { name: "Acme Market", address: "Avenida Siempreviva 742" };
  assert.equal(offerTitle("Comprar leche", place, 900, "es"), "Comprar leche · Acme Market · 900 m");
  const spoken = offerSpoken("Comprar leche", place, 1480, "es");
  assert.equal(spoken, "Comprar leche: Acme Market, a un kilómetro y medio, en Avenida Siempreviva 742.");
  assert.doesNotMatch(spoken, /km|\p{Extended_Pictographic}/u);
  assert.equal(offerSpoken("Buy milk", { name: "Acme" }, 900, "en"), "Buy milk: Acme, 900 meters away.");
});

test("Maps links go to the place, or to the destination with the place as a stop", () => {
  const p = { lat: -34.6, lon: -58.4 };
  assert.equal(navigateUrl(p), "https://www.google.com/maps/dir/?api=1&destination=-34.6,-58.4&travelmode=driving");
  assert.equal(
    addStopUrl(p, { lat: -34.7, lon: -58.5 }),
    "https://www.google.com/maps/dir/?api=1&destination=-34.7,-58.5&waypoints=-34.6,-58.4&travelmode=driving",
  );
  assert.match(addStopUrl(p, { label: "Northwind office" }) ?? "", /destination=Northwind%20office&waypoints=/);
  assert.equal(addStopUrl(p, undefined), undefined);
});
