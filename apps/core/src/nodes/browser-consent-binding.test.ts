import assert from "node:assert/strict";
import { test } from "node:test";
import { bindBrowserEpoch, unbindBrowserEpoch } from "./browser-consent-binding.ts";

test("browser consent binds an epoch to its current node connection, not a reusable tab identifier", () => {
  const binding = bindBrowserEpoch("connection1", "epoch1");
  assert.equal(unbindBrowserEpoch("connection1", binding), "epoch1");
  assert.throws(() => unbindBrowserEpoch("connection2", binding), /connection changed/);
  for (const invalid of ["epoch1", "null", "{}", '["connection1"]', '["connection1",42]'])
    assert.throws(() => unbindBrowserEpoch("connection1", invalid), /connection changed/);
});
