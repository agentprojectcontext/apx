import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallStatus } from "@apx/protocol";
import { callScene } from "./calls.ts";

const status = (extra: Partial<CallStatus> = {}): CallStatus => ({ ready: true, running: true, ...extra });

test("a call on the phone or in another window shows here with its hang up; one this panel holds does not", () => {
  assert.equal(callScene({ status: status({ live: "t1", live_device: "Pixel 8" }) }), "elsewhere");
  assert.equal(callScene({ status: status({ live: "t1" }) }), "elsewhere");
  assert.equal(callScene({ status: status({ live: "t1" }), live: "t1" }), undefined);
  assert.equal(callScene({ status: status({ live: "t1" }), card: { thread: "t1" } }), undefined);
});

test("this computer listens for the name only while no call goes on anywhere", () => {
  assert.equal(callScene({ status: status() }), "quiet");
  assert.equal(callScene({}), "quiet");
  assert.equal(callScene({ status: status(), card: {} }), undefined);
  assert.equal(callScene({ status: status(), live: "t2" }), undefined);
});
