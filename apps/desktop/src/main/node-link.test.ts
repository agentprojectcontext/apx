import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { RequestHandler } from "@apx/protocol/client";
import { startNodeLink } from "./node-link.ts";

class Host extends EventEmitter<{ changed: [] }> {
  calls = 0;
  dropped = 0;
  list() {
    return [];
  }
  async handle() {
    this.calls++;
    return {};
  }
  dropHolds() {
    this.dropped++;
  }
}

class Socket {
  handler: RequestHandler | undefined;
  closes = 0;
  events = 0;
  private finish: () => void = () => {};
  closed = new Promise<void>((resolve) => {
    this.finish = resolve;
  });
  onRequest(handler: RequestHandler) {
    this.handler = handler;
  }
  emit() {
    this.events++;
  }
  close() {
    this.closes++;
    this.finish();
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("stopping a node revokes calls, events and reconnects without leaving host listeners", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const host = new Host();
  const socket = new Socket();
  let connects = 0;
  const link = startNodeLink(
    host,
    "http://core.example",
    () => {},
    undefined,
    undefined,
    async () => {
      connects++;
      return socket;
    },
  );
  await flush();
  assert.ok(socket.handler);
  await socket.handler("browser.tabs", {});
  assert.equal(host.calls, 1);
  host.emit("changed");
  assert.equal(socket.events, 1);
  link.stop();
  link.stop();
  assert.equal(socket.closes, 1);
  assert.equal(host.listenerCount("changed"), 0);
  assert.equal(host.dropped, 1);
  await assert.rejects(socket.handler("browser.tabs", {}), /connection ended/);
  host.emit("changed");
  link.emit("computer.stopped");
  assert.equal(socket.events, 1);
  assert.equal(host.calls, 1);
  await flush();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(connects, 1);
});

test("stopping a pending connection aborts its handshake and rejects a late successful socket", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const host = new Host();
  const socket = new Socket();
  let complete: (socket: Socket) => void = () => {};
  let signal: AbortSignal | undefined;
  const states: string[] = [];
  const link = startNodeLink(
    host,
    "http://old.example",
    (state) => states.push(state),
    undefined,
    undefined,
    (_caps, s) => {
      signal = s;
      return new Promise<Socket>((resolve) => {
        complete = resolve;
      });
    },
  );
  link.stop();
  assert.equal(signal?.aborted, true);
  complete(socket);
  await flush();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(socket.closes, 1);
  assert.equal(socket.handler, undefined);
  assert.deepEqual(states, ["offline"]);
  assert.equal(host.listenerCount("changed"), 0);
  assert.equal(host.dropped, 1);
});

test("stopping during reconnect backoff prevents a previous core from reconnecting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const host = new Host();
  let connects = 0;
  const link = startNodeLink(
    host,
    "http://old.example",
    () => {},
    undefined,
    undefined,
    async () => {
      connects++;
      throw new Error("offline");
    },
  );
  await flush();
  link.stop();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(connects, 1);
  assert.equal(host.listenerCount("changed"), 0);
});
