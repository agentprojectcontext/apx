import assert from "node:assert/strict";
import { test } from "node:test";
import { manualTimers, waitFor } from "../../core/src/testkit/platform.ts";
import { createPublicationController } from "./controller.ts";

const copy = {
  bundle: {
    format: "apx-artifact@1" as const,
    manifest: { name: "orders", title: "Orders", kind: "widget" as const, version: 1 },
    html: "<h1>Orders</h1>",
  },
  json: "approved copy",
  sha256: "a".repeat(64),
};
function fixture(valid = true) {
  const timers = manualTimers();
  let reads = 0;
  let online = true;
  let load = async () => copy;
  const watchers: {
    changed(state: "waiting" | "live" | "missing"): void;
    failed(missing: boolean): void;
    stopped: boolean;
  }[] = [];
  const controller = createPublicationController({
    valid,
    after: timers.after,
    online: () => online,
    load: () => {
      reads++;
      return load();
    },
    watch: (changed, failed) => {
      const watcher = { changed, failed, stopped: false };
      watchers.push(watcher);
      return () => {
        watcher.stopped = true;
      };
    },
  });
  const latest = () => {
    const watcher = watchers.at(-1);
    assert.ok(watcher);
    return watcher;
  };
  return {
    controller,
    timers,
    watchers,
    latest,
    get reads() {
      return reads;
    },
    offline: () => {
      online = false;
    },
    setLoad: (next: typeof load) => {
      load = next;
    },
  };
}

test("an unconfirmed cached snapshot stays loading and reaches its injected deadline without flashing a false failure", () => {
  const f = fixture();
  f.controller.start();
  f.latest().changed("waiting");
  assert.equal(f.controller.snapshot().status, "loading");
  f.timers.tick(14_999);
  assert.equal(f.controller.snapshot().status, "loading");
  f.timers.tick(1);
  assert.equal(f.controller.snapshot().status, "offline");
  assert.equal(f.reads, 0);
  f.controller.stop();
  assert.equal(f.timers.pending(), 0);
});

test("server reads time out on an injected clock and late bytes cannot restore a preview", async () => {
  const f = fixture();
  const gate = Promise.withResolvers<typeof copy>();
  f.setLoad(() => gate.promise);
  f.controller.start();
  f.latest().changed("live");
  await waitFor(() => f.reads === 1, "one server read");
  f.timers.tick(15_000);
  await waitFor(() => f.controller.snapshot().status === "offline", "read deadline");
  gate.resolve(copy);
  await gate.promise;
  assert.equal(f.controller.snapshot().copy, undefined);
  f.controller.stop();
});

test("revocation cancels pending reads, clears an open preview and invalidates a ready download", async () => {
  const f = fixture();
  f.controller.start();
  f.latest().changed("live");
  await waitFor(() => f.controller.snapshot().status === "ready", "loaded preview");
  const receipt = await f.controller.download();
  assert.ok(receipt);
  assert.equal(receipt.current(), true);
  assert.equal(f.reads, 2);
  f.latest().changed("missing");
  assert.equal(f.controller.snapshot().copy, undefined);
  assert.equal(f.controller.snapshot().status, "missing");
  assert.equal(receipt.current(), false);
  assert.equal(await f.controller.download(), undefined);
  f.controller.stop();
});

test("double clicks share the disabled state; a download deadline leaves no usable bytes", async () => {
  const f = fixture();
  f.controller.start();
  f.latest().changed("live");
  await waitFor(() => f.controller.snapshot().status === "ready", "loaded preview");
  const gate = Promise.withResolvers<typeof copy>();
  f.setLoad(() => gate.promise);
  const first = f.controller.download();
  assert.equal(await f.controller.download(), undefined);
  await waitFor(() => f.reads === 2, "one fresh download read");
  f.timers.tick(15_000);
  assert.equal(await first, undefined);
  assert.equal(f.controller.snapshot().downloading, false);
  assert.equal(f.controller.snapshot().copy, undefined);
  gate.resolve(copy);
  f.controller.stop();
});

test("a copy changed during download cannot reuse the visible snapshot's bytes", async () => {
  const f = fixture();
  f.controller.start();
  f.latest().changed("live");
  await waitFor(() => f.controller.snapshot().status === "ready", "loaded preview");
  f.setLoad(async () => ({ ...copy, sha256: "b".repeat(64) }));
  assert.equal(await f.controller.download(), undefined);
  assert.equal(f.controller.snapshot().status, "offline");
  assert.equal(f.controller.snapshot().copy, undefined);
  f.controller.stop();
});

test("retry and unmount ignore callbacks from detached document listeners", async () => {
  const f = fixture();
  f.controller.start();
  const old = f.latest();
  f.controller.start();
  assert.equal(old.stopped, true);
  old.changed("missing");
  old.failed(true);
  assert.equal(f.controller.snapshot().status, "loading");
  f.latest().changed("live");
  await waitFor(() => f.controller.snapshot().status === "ready", "new listener");
  f.controller.stop();
  f.latest().changed("missing");
  f.latest().failed(true);
  assert.equal(f.controller.snapshot().status, "ready");
  assert.equal(await f.controller.download(), undefined);
  assert.equal(f.timers.pending(), 0);
});

test("unmounting before a deferred read starts never issues that read", async () => {
  const f = fixture();
  f.controller.start();
  f.latest().changed("live");
  f.controller.stop();
  await waitFor(() => f.timers.pending() === 0, "cancelled read cleanup");
  assert.equal(f.reads, 0);
});

test("a disconnected browser clears the preview while invalid codes never start a listener", async () => {
  const f = fixture();
  f.controller.start();
  f.latest().changed("live");
  await waitFor(() => f.controller.snapshot().status === "ready", "loaded preview");
  f.offline();
  f.latest().changed("waiting");
  assert.equal(f.controller.snapshot().status, "offline");
  assert.equal(f.controller.snapshot().copy, undefined);
  f.controller.stop();
  const invalid = fixture(false);
  invalid.controller.start();
  assert.equal(invalid.controller.snapshot().status, "missing");
  assert.equal(invalid.watchers.length, 0);
  assert.equal(invalid.timers.pending(), 0);
  invalid.controller.stop();
});
