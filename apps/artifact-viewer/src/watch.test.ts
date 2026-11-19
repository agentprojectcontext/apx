import assert from "node:assert/strict";
import { test } from "node:test";
import { manualTimers, waitFor } from "../../core/src/testkit/platform.ts";
import { createPublicationController } from "./controller.ts";
import { createPublicationWatch } from "./watch.ts";

type Events = { open(): void; closed(): void; message(data: unknown): void };
function fixture() {
  const timers = manualTimers();
  const sockets: { events?: Events; closed: boolean; detached: boolean }[] = [];
  const states: string[] = [];
  const failures: boolean[] = [];
  let reads = 0;
  let hidden = false;
  let removed = false;
  let visibility = () => {};
  let metadata: (signal: AbortSignal) => Promise<unknown> = async () => ({ revision: "one" });
  const start = (observe?: (state: "waiting" | "live" | "missing") => void) =>
    createPublicationWatch(
      {
        metadata: (signal) => {
          reads++;
          return metadata(signal);
        },
        socket: () => {
          const record: (typeof sockets)[number] = { closed: false, detached: false };
          sockets.push(record);
          return {
            listen(events) {
              record.events = events;
              return () => {
                record.detached = true;
              };
            },
            close() {
              record.closed = true;
            },
          };
        },
        hidden: () => hidden,
        visibility(notify) {
          visibility = notify;
          return () => {
            removed = true;
          };
        },
        after: timers.after,
      },
      (state) => {
        states.push(state);
        observe?.(state);
      },
      (missing) => failures.push(missing),
    );
  const events = (index = sockets.length - 1) => {
    const value = sockets[index]?.events;
    assert.ok(value);
    return value;
  };
  return {
    start,
    timers,
    sockets,
    states,
    failures,
    events,
    reads: () => reads,
    hide(value: boolean) {
      hidden = value;
      if (!removed) visibility();
    },
    setMetadata(next: typeof metadata) {
      metadata = next;
    },
  };
}

test("an update completed before the socket handshake replaces an already rendered older copy", async () => {
  const f = fixture();
  const copy = (html: string) => ({
    bundle: {
      format: "apx-artifact@1" as const,
      manifest: { name: "orders", title: "Orders", kind: "widget" as const, version: 1 },
      html,
    },
    json: html,
    sha256: "a".repeat(64),
  });
  let current = copy("Revision A");
  const controller = createPublicationController({
    valid: true,
    load: async () => current,
    watch: (changed) => f.start(changed),
    after: f.timers.after,
    online: () => true,
  });
  try {
    controller.start();
    await waitFor(() => controller.snapshot().copy?.bundle.html === "Revision A", "first revision rendered");
    current = copy("Revision B");
    f.events().open();
    await waitFor(() => controller.snapshot().copy?.bundle.html === "Revision B", "handshake catches missed update");
    f.timers.tick(86_400_000);
    assert.equal(controller.snapshot().copy?.bundle.html, "Revision B");
    assert.equal(f.reads(), 1, "synchronization is event-driven, not a metadata poll");
  } finally {
    controller.stop();
  }
});

test("a connected viewer receives changes without polling and a revocation terminates its stream", async () => {
  const f = fixture();
  const stop = f.start();
  await waitFor(() => f.sockets.length === 1, "watch socket");
  f.events().open();
  f.timers.tick(86_400_000);
  assert.equal(f.reads(), 1);
  assert.equal(f.timers.pending(), 0);
  f.events().message(JSON.stringify({ state: "live" }));
  f.events().message(JSON.stringify({ state: "missing" }));
  assert.deepEqual(f.states, ["waiting", "live", "live", "live", "missing"]);
  f.events().message(JSON.stringify({ state: "live" }));
  f.timers.tick(86_400_000);
  assert.equal(f.states.at(-1), "missing");
  assert.equal(f.reads(), 1);
  assert.equal(f.sockets[0]?.closed, true);
  stop();
});

test("disconnects clear the preview; hidden pages stop work without failing and resume from a fresh server read", async () => {
  const f = fixture();
  const stop = f.start();
  await waitFor(() => f.sockets.length === 1, "initial socket");
  const detached = f.events();
  detached.open();
  detached.closed();
  assert.deepEqual(f.failures, [false]);
  detached.message(JSON.stringify({ state: "missing" }));
  f.timers.tick(999);
  assert.equal(f.reads(), 1);
  f.timers.tick(1);
  await waitFor(() => f.sockets.length === 2, "reconnected socket");
  f.events().open();
  f.hide(true);
  assert.equal(f.sockets[1]?.closed, true);
  assert.deepEqual(f.failures, [false], "switching windows is not a failure: the copy stays on screen");
  f.timers.tick(86_400_000);
  assert.equal(f.reads(), 2);
  f.hide(false);
  await waitFor(() => f.sockets.length === 3, "visible socket");
  f.events().open();
  stop();
  assert.equal(f.timers.pending(), 0);
  f.hide(false);
  assert.equal(f.reads(), 3);
});

test("handshake deadlines use an injected clock; detached callbacks cannot defeat backoff or restore content", async () => {
  const f = fixture();
  const stop = f.start();
  await waitFor(() => f.sockets.length === 1, "unconfirmed socket");
  const old = f.events();
  f.timers.tick(10_000);
  assert.deepEqual(f.failures, [false]);
  old.open();
  old.message(JSON.stringify({ state: "live" }));
  assert.equal(f.timers.pending(), 1);
  f.timers.tick(1000);
  await waitFor(() => f.sockets.length === 2, "replacement socket");
  f.events().open();
  assert.equal(f.timers.pending(), 0);
  f.events().message("x".repeat(4097));
  assert.deepEqual(f.failures, [false, false]);
  stop();
  assert.equal(f.timers.pending(), 0);
});

test("a missing copy never starts a socket; late metadata after unmount cannot reconnect", async () => {
  const missing = fixture();
  missing.setMetadata(async () => {
    throw new Error("public_artifact_missing");
  });
  const stopMissing = missing.start();
  await waitFor(() => missing.states.at(-1) === "missing", "missing state");
  assert.equal(missing.sockets.length, 0);
  assert.equal(missing.timers.pending(), 0);
  stopMissing();
  const f = fixture();
  const pending = Promise.withResolvers<unknown>();
  let aborted = false;
  let completed = false;
  f.setMetadata((signal) => {
    signal.addEventListener("abort", () => {
      aborted = true;
    });
    return pending.promise.finally(() => {
      completed = true;
    });
  });
  const stop = f.start();
  stop();
  pending.resolve({ revision: "late" });
  await waitFor(() => completed, "settled metadata");
  assert.equal(aborted, true);
  assert.equal(f.sockets.length, 0);
  assert.deepEqual(f.states, ["waiting"]);
  assert.equal(f.timers.pending(), 0);
});
