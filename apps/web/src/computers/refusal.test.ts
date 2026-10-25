import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { memoryRefusal } from "./refusal.ts";

test("a start refused for memory is read from the core's numbers, never from its English message", () => {
  const detail = { reason: "memory", free_gib: 5.5, vm_gib: 4, reserve_gib: 2, fits_gib: 3, anyway: true };
  const refused = new ApxError({ code: "conflict", message: "not enough free memory on this computer", detail });
  assert.deepEqual(memoryRefusal(refused), detail);
  const { fits_gib: _, ...noSmaller } = detail;
  assert.deepEqual(memoryRefusal(new ApxError({ code: "conflict", message: "", detail: noSmaller })), noSmaller);
  assert.equal(
    memoryRefusal(new ApxError({ code: "conflict", message: "stop Computer before deleting its chat" })),
    undefined,
  );
  assert.equal(memoryRefusal(new Error("network down")), undefined);
  assert.equal(memoryRefusal(new ApxError({ code: "conflict", message: "", detail: { reason: "memory" } })), undefined);
});
