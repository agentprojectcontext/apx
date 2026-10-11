import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionState, shouldAsk } from "./notificationPermission.ts";

test("a permission not yet given is off while the system can still ask, denied once it cannot", () => {
  assert.equal(permissionState({ granted: true, canAskAgain: false }), "granted");
  assert.equal(permissionState({ granted: false, canAskAgain: false, provisional: true }), "granted");
  assert.equal(permissionState({ granted: false, canAskAgain: true }), "off");
  assert.equal(permissionState({ granted: false, canAskAgain: false }), "denied");
});

test("the system prompt waits for the owner's tap", () => {
  assert.equal(shouldAsk("off", false), false);
  assert.equal(shouldAsk("off", true), true);
  assert.equal(shouldAsk("denied", true), false);
  assert.equal(shouldAsk("granted", true), false);
});
