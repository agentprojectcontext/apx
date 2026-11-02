import assert from "node:assert/strict";
import { ObserverReader } from "../observer-reader.ts";

const executable = process.env.OBSERVER_HELPER;
const home = process.env.OBSERVER_SCRATCH;
assert.ok(executable, "Set OBSERVER_HELPER to the freshly compiled observer");
assert.ok(home, "Set OBSERVER_SCRATCH to an isolated existing scratch folder");
const observer = new ObserverReader({ executable, home });
try {
  for (const seconds of [1, 2]) {
    const result = await observer.request({
      op: "listWindows",
      pid: 2_147_483_647,
      launchIdentity: { seconds, microseconds: 0 },
    });
    assert.deepEqual(result, { kind: "error", code: "IDENTITY_MISMATCH" });
  }
} finally {
  await observer.stop();
}
await assert.rejects(
  observer.request({
    op: "listWindows",
    pid: 2_147_483_647,
    launchIdentity: { seconds: 1, microseconds: 0 },
  }),
  /^Error: OBSERVER_READ_FAILED$/,
);
process.stdout.write("Validated native transport: two identity refusals and terminal stop passed (no AX read).\n");
