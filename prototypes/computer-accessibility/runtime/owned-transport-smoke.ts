import assert from "node:assert/strict";
import { OwnedObserver } from "../owned-observer.ts";

const executable = process.env.OBSERVER_HELPER;
const home = process.env.OBSERVER_SCRATCH;
assert.ok(executable, "Set OBSERVER_HELPER to the freshly compiled observer");
assert.ok(home, "Set OBSERVER_SCRATCH to an isolated existing scratch folder");
const observer = new OwnedObserver({ executable, home });
try {
  await observer.ready();
  const result = await observer.request({
    op: "listWindows",
    pid: 0,
    launchIdentity: { seconds: 1, microseconds: 0 },
  });
  assert.equal(result.version, 1);
  assert.equal(result.error, "INVALID_REQUEST");
  assert.equal(result.listing, undefined);
  assert.equal(result.selectedObservation, undefined);
} finally {
  await observer.stop();
}
await assert.rejects(observer.ready(), /OBSERVER_STOPPED/);
process.stdout.write("Owned native transport: hello, invalid request, closed terminal stop passed (no AX read).\n");
