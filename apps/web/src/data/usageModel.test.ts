import assert from "node:assert/strict";
import { test } from "node:test";
import type { SystemUsage } from "@apx/protocol";
import { createUsagePoller, processRows, ramSplit, size } from "./usageModel.ts";

const usage = (over: Partial<SystemUsage> = {}): SystemUsage => ({
  at: "2026-01-01T00:00:00.000Z",
  host: { platform: "darwin", memory_total_mb: 16384, memory_available_mb: 6144, cpus: 8, load: [1, 1, 1], disks: [] },
  core: { pid: 1, rss_mb: 300, heap_mb: 120, cpu_pct: 2 },
  ...over,
});

test("sizes read as MB, GB and TB", () => {
  assert.equal(size(850), "850 MB");
  assert.equal(size(6348), "6.2 GB");
  assert.equal(size(2 * 1048576), "2.0 TB");
});

test("processes are the core and the desktop's, biggest first", () => {
  const rows = processRows(usage(), {
    total_mb: 900,
    items: [
      { pid: 2, kind: "panel", mb: 500 },
      { pid: 3, kind: "tab", site: "example.com", mb: 400 },
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.kind, r.mb]),
    [
      ["panel", 500],
      ["tab", 400],
      ["core", 300],
    ],
  );
  assert.equal(rows.find((r) => r.kind === "core")?.cpu_pct, 2);
  assert.deepEqual(processRows(undefined, undefined), []);
});

test("RAM splits into APX, the VM, other apps and free, adding up to the whole", () => {
  const vm = { running: true, memory_assigned_mb: 4096, memory_used_mb: 2048 };
  const r = ramSplit(usage({ vm }), { total_mb: 700, items: [] });
  assert.deepEqual(r, { total: 16384, apx: 1000, vm: 2048, other: 10240 - 3048, free: 6144, used: 10240 });
  assert.equal(r.apx + r.vm + r.other + r.free, r.total);
  assert.equal(ramSplit(usage({ vm: { ...vm, running: false } }), undefined).vm, 0, "a stopped VM takes none");
});

test("one poll for all views: the most eager cadence, detail while one wants it, nothing once all leave", async () => {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const reads: boolean[] = [];
  let t = 0;
  const p = createUsagePoller({
    read: async (detail) => {
      reads.push(detail);
      return {};
    },
    onSnapshot: () => {},
    setTimer: (fn, ms) => timers.push({ fn, ms }) - 1,
    clearTimer: (i) => {
      timers[i as number] = { fn: () => {}, ms: -1 };
    },
    now: () => t,
  });
  const fire = async () => {
    const live = timers.filter((x) => x.ms >= 0).at(-1);
    timers.length = 0;
    live?.fn();
    await new Promise((r) => setImmediate(r));
  };
  const offGauge = p.watch({ detail: false, every: 60_000 });
  await fire();
  assert.deepEqual(reads, [false], "the first watcher reads at once");
  assert.equal(timers.at(-1)?.ms, 60_000);
  t = 1_000;
  const offDialog = p.watch({ detail: true, every: 5_000 });
  assert.equal(timers.filter((x) => x.ms >= 0).at(-1)?.ms, 0, "a view wanting detail reads at once");
  await fire();
  assert.deepEqual(reads, [false, true]);
  assert.equal(timers.at(-1)?.ms, 5_000, "then at the eager cadence");
  offDialog();
  assert.ok((timers.filter((x) => x.ms >= 0).at(-1)?.ms ?? 0) > 5_000, "back to the gauge's cadence");
  offGauge();
  assert.equal(timers.filter((x) => x.ms >= 0).length, 0, "nobody looking: no timer");
});
