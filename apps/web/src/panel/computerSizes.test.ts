import assert from "node:assert/strict";
import { test } from "node:test";
import { setupSizes } from "./computerSizes.ts";

test("the computer's setup hint uses the core's sizes and guesses none before they arrive", () => {
  assert.equal(setupSizes(undefined), undefined);
  // A machine the core gave 8 GiB showed 4 while its status loaded.
  assert.deepEqual(setupSizes({ memory_gib: 8, disk_gib: 32 }), { memory: 8, disk: 34 });
});
