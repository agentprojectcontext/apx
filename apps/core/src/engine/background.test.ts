import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { createBackground } from "./background.ts";

const warned: string[] = [];
const log = { info() {}, warn: (o: { check: string }) => void warned.push(o.check), error() {}, debug() {} } as never;
const at = (s: number) => new Date(2026, 9, 1, 12, 0, s);

test("a check runs on the first beat, then once its interval passed", () => {
  const ran: number[] = [];
  const bg = createBackground(log, [{ id: "a", everyMs: 60_000, run: (t) => void ran.push(t.getSeconds()) }]);
  bg.tick(at(0));
  bg.tick(at(15));
  bg.tick(at(59));
  assert.deepEqual(ran, [0]);
  bg.tick(at(60));
  assert.equal(ran.length, 2);
});

test("a slow check is never started twice, and one that fails does not stop the others", async () => {
  let release: () => void = () => {};
  let started = 0;
  const ran: string[] = [];
  const bg = createBackground(log, [
    {
      id: "slow",
      everyMs: 1000,
      run: () => {
        started++;
        return new Promise<void>((res) => (release = res));
      },
    },
    {
      id: "broken",
      everyMs: 1000,
      run: () => {
        throw new Error("no");
      },
    },
    { id: "fine", everyMs: 1000, run: () => void ran.push("fine") },
  ]);
  bg.tick(at(0));
  bg.tick(at(5));
  assert.equal(started, 1, "still running at the next beat");
  assert.deepEqual(ran, ["fine", "fine"]);
  assert.ok(warned.includes("broken"));
  release();
  await waitFor(async () => {
    bg.tick(at(10 + started));
    return started === 2;
  }, "the slow check to run again once it ended");
});
