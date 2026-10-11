import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxError } from "../../../packages/protocol/src/client.ts";
import { unpairDevice } from "./unpair.ts";

const tracked = () => {
  const steps: string[] = [];
  return { steps, forget: async () => void steps.push("forget") };
};

test("unpairing revokes the key on the core before the phone forgets it", async () => {
  const { steps, forget } = tracked();
  const outcome = await unpairDevice(async () => void steps.push("revoke"), forget);
  assert.equal(outcome, "revoked");
  assert.deepEqual(steps, ["revoke", "forget"]);
});

test("a core out of reach still lets the phone forget, and says only the phone did", async () => {
  const { steps, forget } = tracked();
  const outcome = await unpairDevice(async () => {
    throw new TypeError("Network request failed");
  }, forget);
  assert.equal(outcome, "local");
  assert.deepEqual(steps, ["forget"]);
});

test("a key the core already refuses counts as revoked", async () => {
  const { steps, forget } = tracked();
  const outcome = await unpairDevice(async () => {
    throw new ApxError({ code: "unauthorized", message: "missing or bad token" });
  }, forget);
  assert.equal(outcome, "revoked");
  assert.deepEqual(steps, ["forget"]);
});
