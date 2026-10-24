import assert from "node:assert/strict";
import test from "node:test";
import { createInputQueue } from "./terminalInput.ts";

const settle = () => new Promise((r) => setTimeout(r, 60));

/** A transport like the browser's: calls overlap, and an early one can take longer to reach the core than a later one. */
function slowFirstTransport() {
  const arrived: string[] = [];
  let inFlight = 0;
  let overlapped = false;
  let calls = 0;
  const send = (data: string) => {
    const delay = calls++ === 0 ? 25 : 1;
    inFlight++;
    if (inFlight > 1) overlapped = true;
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        inFlight--;
        arrived.push(data);
        resolve();
      }, delay),
    );
  };
  return { send, arrived, overlapped: () => overlapped };
}

test("keys typed while an earlier one is still on its way reach the terminal in the order typed", async () => {
  const net = slowFirstTransport();
  const type = createInputQueue(net.send);
  const typed = "echo e2e-$((6*7))";
  for (const key of typed) type(key);
  type("\r");
  await settle();
  assert.equal(net.arrived.join(""), `${typed}\r`);
  assert.equal(net.overlapped(), false, "one request at a time per terminal");
});

test("what is typed while a request is in flight goes up together afterwards", async () => {
  const net = slowFirstTransport();
  const type = createInputQueue(net.send);
  for (const key of "ls -la") type(key);
  await settle();
  assert.deepEqual(net.arrived, ["l", "s -la"]);
});

test("a paste longer than one request carries goes up in pieces, in order", async () => {
  const net = slowFirstTransport();
  const type = createInputQueue(net.send);
  const paste = `${"a".repeat(64 * 1024)}${"b".repeat(10)}`;
  type(paste);
  await settle();
  assert.deepEqual(
    net.arrived.map((d) => d.length),
    [64 * 1024, 10],
  );
  assert.equal(net.arrived.join(""), paste);
});

test("a request that fails loses its keys, not the ones typed after it", async () => {
  const arrived: string[] = [];
  let first = true;
  const type = createInputQueue(async (data) => {
    if (first) {
      first = false;
      throw new Error("offline");
    }
    arrived.push(data);
  });
  type("a");
  type("b");
  type("c");
  await settle();
  assert.equal(arrived.join(""), "bc");
  type("d");
  await settle();
  assert.equal(arrived.join(""), "bcd");
});
