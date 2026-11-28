import assert from "node:assert/strict";
import { test } from "node:test";
import { PHONE_CAPS as CORE_ACCEPTS } from "../../../packages/protocol/src/device-methods.ts";
import { handlePhoneRequest, PHONE_CAPS, type PhoneDeps } from "./phoneRequests.ts";

const deps = (over: Partial<PhoneDeps> = {}): PhoneDeps => ({
  location: async () => ({ lat: -41.13, lon: -71.31, accuracy_m: 10 }),
  photo: async (reason) => (reason === "decline" ? undefined : { mime: "image/jpeg", data: "AAA" }),
  now: () => new Date("2026-10-04T10:00:00Z"),
  ...over,
});

test("where the phone is, with when it was read", async () => {
  assert.deepEqual(await handlePhoneRequest("phone.location", {}, deps()), {
    lat: -41.13,
    lon: -71.31,
    accuracy_m: 10,
    at: "2026-10-04T10:00:00.000Z",
  });
  await assert.rejects(handlePhoneRequest("phone.location", {}, deps({ location: async () => undefined })), /allow/);
});

test("a picture comes back as its bytes; a declined one is an error the agent reads", async () => {
  assert.deepEqual(await handlePhoneRequest("phone.photo", { reason: "fridge" }, deps()), {
    mime: "image/jpeg",
    data: "AAA",
  });
  await assert.rejects(handlePhoneRequest("phone.photo", { reason: "decline" }, deps()), /did not take/);
  await assert.rejects(handlePhoneRequest("browser.open", {}, deps()), /does not serve/);
});

test("the phone lends only what the core accepts from a phone, or its node link is refused", () => {
  for (const cap of PHONE_CAPS) assert.ok(CORE_ACCEPTS.includes(cap), cap);
});
