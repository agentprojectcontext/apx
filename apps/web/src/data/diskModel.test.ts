import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiskStatus } from "@apx/protocol";
import { diskWarning } from "./diskModel.ts";

const GB = 1024 ** 3;
const status = (free: number): DiskStatus => ({
  free_bytes: free,
  total_bytes: 500 * GB,
  low: free < 5 * GB,
  threshold_bytes: 5 * GB,
});

test("the disk warning follows storage.status: the card until closed, then the mark, gone once there is room", () => {
  assert.equal(diskWarning(undefined, false), undefined, "before the first status, or an older core");
  assert.equal(diskWarning(status(100 * GB), false), undefined);
  assert.equal(diskWarning(status(4 * GB), false), "card");
  assert.equal(diskWarning(status(4 * GB), true), "mark", "closed: the mark stays while the disk is low");
  assert.equal(diskWarning(status(6 * GB), true), undefined, "room again: the mark goes by itself");
  assert.equal(diskWarning(status(3 * GB), true), "mark", "low again in the same session: the mark, not the card");
});
