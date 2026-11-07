import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { waitFor } from "../../../core/src/testkit/platform.ts";
import { createNativePointer, type PointerChild } from "./computer-native-pointer.ts";

function fixture() {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kills: unknown[] = [];
  const requests: Record<string, unknown>[] = [];
  let launches = 0;
  let received: () => void = () => {};
  const firstRequest = new Promise<void>((resolve) => {
    received = resolve;
  });
  stdin.on("data", (chunk: Buffer) => {
    requests.push(JSON.parse(chunk.toString()));
    received();
  });
  const child: PointerChild = {
    stdin,
    stdout,
    stderr,
    on: events.on.bind(events),
    once: events.once.bind(events),
    kill(signal) {
      kills.push(signal);
      return true;
    },
  };
  const pointer = createNativePointer({
    executable: path.resolve("fixture-helper"),
    launch: () => {
      launches++;
      queueMicrotask(() => stdout.write('{"version":1,"ready":true}\n'));
      return child;
    },
  });
  return {
    pointer,
    requests,
    kills,
    stdout,
    stderr,
    firstRequest,
    get launches() {
      return launches;
    },
    reply(value: Record<string, unknown>) {
      stdout.write(`${JSON.stringify({ id: requests.at(-1)?.id, ...value })}\n`);
    },
    exit() {
      events.emit("close", 0);
    },
  };
}

test("native overlay and press reuse one process with captured agent labels", async () => {
  const f = fixture();
  f.pointer.selectAgent({ id: "agent-a", name: "Acme" });
  const moving = f.pointer.moveTo(-200, 80, "Open item");
  f.pointer.selectAgent({ id: "agent-b", name: "Northwind" });
  await waitFor(() => f.requests.length === 1);
  assert.deepEqual(f.requests[0], { id: 1, op: "move", agent: "agent-a", label: "Acme · Open item", x: -200, y: 80 });
  f.reply({ status: "accepted" });
  await moving;
  const pressing = f.pointer.press("Acme app", -200, 80, new AbortController().signal);
  await waitFor(() => f.requests.length === 2);
  assert.equal(f.requests[1]?.agent, "agent-b");
  assert.equal(f.requests[1]?.label, "Northwind");
  f.reply({ status: "accepted", action: "pressed", role: "AXButton", durationMs: 24 });
  assert.equal(await pressing, "native accessible press; pressed AXButton");
  assert.equal(f.launches, 1);
  f.pointer.close();
  assert.deepEqual(f.kills, ["SIGKILL"]);
  f.exit();
  await f.pointer.drained();
});

test("stop retires pending and queued cursor commands without late movement", async () => {
  const f = fixture();
  const first = f.pointer.moveTo(50, 60, "First");
  const rejected = assert.rejects(first, /cancelled/);
  const second = f.pointer.moveTo(70, 80, "Queued");
  const dropped = assert.rejects(second, /cancelled/);
  await waitFor(() => f.requests.length === 1);
  f.pointer.hide();
  assert.deepEqual(f.kills, ["SIGKILL"]);
  f.exit();
  await Promise.all([rejected, dropped, f.pointer.drained()]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.launches, 1);
  f.pointer.close();
});

test("cancelling a press waits for process close and never retries it", async () => {
  const f = fixture();
  const controller = new AbortController();
  const pressing = f.pointer.press("Acme", 10, 20, controller.signal);
  let settled = false;
  const rejected = assert.rejects(pressing, /cancelled.*uncertain.*do not retry/).then(() => {
    settled = true;
  });
  await waitFor(() => f.requests.length === 1);
  controller.abort();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(f.kills, ["SIGKILL"]);
  f.exit();
  await rejected;
  assert.equal(f.requests.length, 1);
  f.pointer.close();
});

test("an already aborted action never starts a helper", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.pointer.press("Acme", 1, 2, controller.signal), /cancelled/);
  assert.equal(f.launches, 0);
  f.pointer.close();
});

for (const response of [
  { status: "uncertain", reason: "press_uncertain" },
  { status: "accepted", action: "clicked", role: "AXButton" },
  { status: "accepted", action: "pressed", role: "not-a-role" },
]) {
  test(`native press rejects ${JSON.stringify(response)} without fallback`, async () => {
    const f = fixture();
    const pressing = f.pointer.press("Acme", 1, 2, new AbortController().signal);
    const rejected = assert.rejects(pressing, /uncertain.*do not retry/);
    await waitFor(() => f.requests.length === 1);
    f.reply(response);
    await rejected;
    assert.equal(f.requests.length, 1);
    f.pointer.close();
    f.exit();
    await f.pointer.drained();
  });
}

test("deadline kills and waits for close instead of freeing the action early", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const pressing = f.pointer.press("Acme", 1, 2, new AbortController().signal);
  const rejected = assert.rejects(pressing, /timed out.*uncertain/);
  await f.firstRequest;
  t.mock.timers.tick(4000);
  assert.deepEqual(f.kills, ["SIGKILL"]);
  f.exit();
  await rejected;
  f.pointer.close();
  await f.pointer.drained();
});
