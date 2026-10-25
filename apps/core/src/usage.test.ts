// system.usage: the computer's memory, CPU and disk, what the core takes, the APX home by part (measured in the
// background, kept, cut at its deadline) and the VM's slot, filled by whatever provider the core was given.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { testConfig } from "./config.ts";
import { createCore } from "./server.ts";
import { removeDir, tempDir, waitFor } from "./testkit/platform.ts";
import { availableFromMeminfo, availableFromVmStat, createUsage, measureHome, partOf } from "./usage.ts";

const MB = 1048576;
let core: Awaited<ReturnType<typeof createCore>>;
let home = "";
let owner: ApxClient;
let vm: { running: boolean; memory_assigned_mb: number; memory_used_mb: number } | undefined;

function write(rel: string, bytes: number) {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
}

before(async () => {
  home = tempDir("apx-usage-").path;
  core = await createCore(testConfig({ home }), { quiet: true, vmUsage: () => vm });
  owner = new ApxClient({ url: core.url });
  write("models/ggml-base.bin", 3 * MB);
  write("media/2026-01-01/a.jpg", 2 * MB);
  write("artifacts/global/x/index.html", MB);
  write("computer/disk.img", 2 * MB);
});
after(async () => {
  await core.close();
  await removeDir(home);
});

test("the computer's memory, CPU and disks, and the core's own share, come without the home's size unless asked", async () => {
  const u = await owner.call("system.usage", {});
  assert.ok(u.host.memory_total_mb > 0);
  assert.ok(u.host.memory_available_mb > 0 && u.host.memory_available_mb <= u.host.memory_total_mb);
  assert.ok(u.host.cpus >= 1);
  assert.equal(u.host.load.length, 3);
  const roles = u.host.disks.flatMap((d) => d.roles);
  assert.ok(roles.includes("home") && roles.includes("system"), "both volumes are named, once each");
  for (const d of u.host.disks) assert.ok(d.free_mb <= d.total_mb);
  assert.equal(u.core.pid, process.pid);
  assert.ok(u.core.rss_mb > 0);
  assert.equal(u.home, undefined);
  assert.equal(u.vm, undefined, "no VM: no slot");
});

test("asked for disk, the first answer is measuring; the next has the home by part, biggest first", async () => {
  const first = await owner.call("system.usage", { disk: true });
  assert.ok(first.home);
  const h = await waitFor(async () => {
    const home = (await owner.call("system.usage", { disk: true })).home;
    return home && !home.measuring && home.measured_at ? home : undefined;
  }, "the home measured");
  assert.equal(h.measuring, false);
  const by: Record<string, number> = Object.fromEntries(h.parts.map((p) => [p.id, p.mb]));
  assert.ok((by.models ?? 0) >= 3, `models: ${by.models}`);
  assert.ok((by.files ?? 0) >= 3, `media and artifacts: ${by.files}`);
  assert.ok((by.computer ?? 0) >= 2, `the VM folder: ${by.computer}`);
  assert.ok((by.databases ?? 0) > 0, "the core's own database");
  assert.deepEqual(
    h.parts.map((p) => p.mb),
    [...h.parts.map((p) => p.mb)].sort((a, b) => b - a),
  );
  assert.equal(
    h.total_mb,
    h.parts.reduce((n, p) => n + p.mb, 0),
  );
});

test("the VM's slot carries what its provider says, and a provider that fails leaves it out", async () => {
  vm = { running: true, memory_assigned_mb: 4096, memory_used_mb: 1500 };
  assert.deepEqual((await owner.call("system.usage", {})).vm, vm);
  vm = undefined;
  const failing = createUsage({
    home,
    vm: () => {
      throw new Error("no hypervisor");
    },
  });
  assert.equal((await failing.read({ disk: false })).vm, undefined);
});

test("a home measure kept within its time is not walked again; a stale one is", async () => {
  const usage = createUsage({ home, homeTtlMs: 60_000 });
  const wait = () =>
    waitFor(async () => {
      const h = (await usage.read({ disk: true })).home;
      return h && !h.measuring && h.measured_at ? h : undefined;
    }, "the home measured");
  const one = await wait();
  write("models/more.bin", 4 * MB);
  const two = (await usage.read({ disk: true })).home;
  assert.equal(two?.measured_at, one.measured_at, "kept, not walked on each call");
  assert.equal(two?.measuring, false);
  // Past its time at once: once a measure is kept, a later read starts the next walk.
  const stale = createUsage({ home, homeTtlMs: 0 });
  await waitFor(async () => {
    const h = (await stale.read({ disk: true })).home;
    return h?.measured_at && h.measuring;
  }, "a read past its time walking again");
});

test("a walk past its deadline stops and says it is partial", async () => {
  const m = await measureHome(home, -1);
  assert.equal(m.partial, true);
});

test("parts by name, and memory as macOS and Linux count it", () => {
  assert.equal(partOf("apx.db-wal"), "databases");
  assert.equal(partOf("daemon-lock.sqlite"), "databases");
  assert.equal(partOf("jobs"), "logs");
  assert.equal(partOf("codex-images"), "files");
  assert.equal(partOf("channels"), "other");
  const vmStat = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                               10000.",
    "Pages purgeable:                           1000.",
    "Pages wired down:                         20000.",
    "Anonymous pages:                          50000.",
    "Pages occupied by compressor:             10000.",
  ].join("\n");
  const total = 200000 * 16384;
  assert.equal(availableFromVmStat(vmStat, total), (200000 - (50000 - 1000 + 20000 + 10000)) * 16384);
  assert.equal(availableFromVmStat("nothing", total), undefined);
  // What macOS gives back on demand counts as free (cached files, speculative and purgeable pages); apps' inactive
  // memory does not, since taking it means compressing them.
  const busy = [
    ...vmStat.split("\n"),
    "Pages inactive:                           40000.",
    "Pages speculative:                         5000.",
    "File-backed pages:                        60000.",
  ].join("\n");
  assert.equal(availableFromVmStat(busy, total), availableFromVmStat(vmStat, total));
  assert.ok((availableFromVmStat(busy, total) ?? 0) > 10000 * 16384, "more than the never-used pages alone");
  assert.equal(availableFromMeminfo("MemTotal: 100 kB\nMemAvailable:    2048 kB\n"), 2048 * 1024);
});

test("a CPU share is measured over at least a second, so a read right after another does not reset it", async () => {
  let at = 0;
  let host = { busy: 0, total: 0 };
  const usage = createUsage({ home, now: () => at, cpuTimes: () => host });
  const first = await usage.read({ disk: false });
  at = 999;
  host = { busy: 300, total: 1000 };
  const second = await usage.read({ disk: false });
  assert.equal(first.host.cpu_pct, undefined, "no window yet");
  assert.equal(second.host.cpu_pct, undefined, "a window short of a second says nothing");
  at = 1000;
  host = { busy: 250, total: 1000 };
  const third = await usage.read({ disk: false });
  assert.equal(third.host.cpu_pct, 25, "the whole second since the first read, not since the second");
  assert.equal(typeof third.core.cpu_pct, "number");
  at = 1500;
  host = { busy: 900, total: 2000 };
  assert.equal((await usage.read({ disk: false })).host.cpu_pct, 25, "until the next window closes, the last share");
});
