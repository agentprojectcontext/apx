import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceText, parsePoint } from "./places.ts";

test("a point is read from the usual Google Maps links and from plain coordinates", () => {
  assert.deepEqual(parsePoint("-34.6037, -58.3816"), { lat: -34.6037, lon: -58.3816 });
  assert.deepEqual(parsePoint("-34.6037 -58.3816"), { lat: -34.6037, lon: -58.3816 });
  assert.deepEqual(parsePoint("https://www.google.com/maps/@-34.6037,-58.3816,15z"), { lat: -34.6037, lon: -58.3816 });
  assert.deepEqual(parsePoint("https://maps.google.com/?q=-34.60,-58.38"), { lat: -34.6, lon: -58.38 });
  assert.deepEqual(parsePoint("https://www.google.com/maps/search/?api=1&query=-34.6%2C-58.38"), {
    lat: -34.6,
    lon: -58.38,
  });
  // A place's pin wins over the map's centre in the same link.
  assert.deepEqual(
    parsePoint("https://www.google.com/maps/place/Correo/@-34.61,-58.39,17z/data=!3m1!4b1!4m6!3d-34.6012!4d-58.3801"),
    { lat: -34.6012, lon: -58.3801 },
  );
});

test("text without a point, or out of range, gives none", () => {
  assert.equal(parsePoint("Correo de la calle Mitre"), undefined);
  assert.equal(parsePoint("https://maps.app.goo.gl/AbCdEf"), undefined);
  assert.equal(parsePoint("95, 10"), undefined);
});

test("distances read briefly", () => {
  assert.equal(distanceText(643, "en-US"), "640 m");
  assert.equal(distanceText(1420, "en-US"), "1.4 km");
  assert.equal(distanceText(1420, "es-AR"), "1,4 km");
  assert.equal(distanceText(12_600, "en-US"), "13 km");
});
