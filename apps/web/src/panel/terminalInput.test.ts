import assert from "node:assert/strict";
import test from "node:test";
import { createInputQueue } from "./terminalInput.ts";

function controlledTransport() {
  const arrived: string[] = [];
  const pending: { data: string; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }[] = [];
  let overlapped = false;
  const send = (data: string) => {
    if (pending.length) overlapped = true;
    const request = { data, ...Promise.withResolvers<void>() };
    pending.push(request);
    return request.promise;
  };
  const finish = async (error?: Error) => {
    const request = pending.shift();
    assert.ok(request, "a request must be in flight");
    if (error) request.reject(error);
    else {
      arrived.push(request.data);
      request.resolve();
    }
    // The queue's continuation is registered before this observer, so it drains first.
    await request.promise.catch(() => {});
  };
  return { send, arrived, finish, pending: () => pending.length, overlapped: () => overlapped };
}

test("keys typed while an earlier one is still on its way reach the terminal in the order typed", async () => {
  const net = controlledTransport();
  const type = createInputQueue(net.send);
  const typed = "echo e2e-$((6*7))";
  for (const key of typed) type(key);
  type("\r");
  assert.equal(net.pending(), 1);
  await net.finish();
  await net.finish();
  assert.equal(net.arrived.join(""), `${typed}\r`);
  assert.equal(net.pending(), 0);
  assert.equal(net.overlapped(), false, "one request at a time per terminal");
});

test("what is typed while a request is in flight goes up together afterwards", async () => {
  const net = controlledTransport();
  const type = createInputQueue(net.send);
  for (const key of "ls -la") type(key);
  await net.finish();
  await net.finish();
  assert.deepEqual(net.arrived, ["l", "s -la"]);
  assert.equal(net.pending(), 0);
});

test("a paste longer than one request carries goes up in pieces, in order", async () => {
  const net = controlledTransport();
  const type = createInputQueue(net.send);
  const paste = `${"a".repeat(64 * 1024)}${"b".repeat(10)}`;
  type(paste);
  await net.finish();
  await net.finish();
  assert.deepEqual(
    net.arrived.map((d) => d.length),
    [64 * 1024, 10],
  );
  assert.equal(net.arrived.join(""), paste);
  assert.equal(net.pending(), 0);
});

test("a request that fails loses its keys, not the ones typed after it", async () => {
  const net = controlledTransport();
  const type = createInputQueue(net.send);
  type("a");
  type("b");
  type("c");
  await net.finish(new Error("offline"));
  await net.finish();
  assert.equal(net.arrived.join(""), "bc");
  assert.equal(net.pending(), 0);
  type("d");
  await net.finish();
  assert.equal(net.arrived.join(""), "bcd");
  assert.equal(net.pending(), 0);
});
