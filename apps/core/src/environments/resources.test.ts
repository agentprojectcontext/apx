import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  configuredResources,
  defaultResources,
  limaCreateArgs,
  limaEditArgs,
  resolveResources,
  resourceLimits,
  startRefusal,
} from "./resources.ts";
import { computerUsage, diskImageBytes, usedFromMeminfo } from "./usage.ts";

const GIB = 1024 ** 3;
const host = (gib: number, cpus: number) => ({ memoryBytes: gib * GIB, cpus });

test("the default memory grows with the host: 4 GiB on a small Mac, up to 8 GiB on a large one", () => {
  assert.deepEqual(defaultResources(host(8, 8)), { memory_gib: 4, cpus: 2, disk_gib: 24 });
  assert.deepEqual(defaultResources(host(16, 8)), { memory_gib: 4, cpus: 2, disk_gib: 24 });
  assert.deepEqual(defaultResources(host(24, 12)), { memory_gib: 6, cpus: 4, disk_gib: 24 });
  assert.deepEqual(defaultResources(host(64, 16)), { memory_gib: 8, cpus: 4, disk_gib: 24 });
});

test("the owner's values are held to what the host can spare", () => {
  assert.deepEqual(resourceLimits(host(16, 8)), {
    memory_gib: { min: 2, max: 12 },
    cpus: { min: 1, max: 4 },
    disk_gib: { min: 16, max: 256 },
  });
  assert.deepEqual(resolveResources({ memory_gib: 40, cpus: 1, disk_gib: 8 }, host(16, 8)), {
    memory_gib: 12,
    cpus: 1,
    disk_gib: 16,
  });
  assert.deepEqual(resolveResources({}, host(16, 8)), defaultResources(host(16, 8)));
});

test("a start needs the VM's memory plus the reserve free", () => {
  const r = { memory_gib: 4, cpus: 2, disk_gib: 24 };
  assert.equal(startRefusal(r, 6 * GIB), undefined);
  assert.match(startRefusal(r, 5.5 * GIB) ?? "", /5\.5 GiB free, the VM needs 4 GiB plus 2 GiB/);
});

test("Lima gets only the flags that changed, and a disk is never shrunk", () => {
  const wanted = { memory_gib: 6, cpus: 4, disk_gib: 32 };
  assert.deepEqual(limaEditArgs({ memory_gib: 4, cpus: 4, disk_gib: 24 }, wanted), ["--memory=6", "--disk=32"]);
  assert.deepEqual(limaEditArgs({ memory_gib: 6, cpus: 4, disk_gib: 40 }, wanted), []);
  assert.deepEqual(limaCreateArgs(wanted), ["--cpus=4", "--memory=6", "--disk=32"]);
  assert.deepEqual(configuredResources('cpus: 2\nmemory: "4GiB"\ndisk: 24GiB\n'), {
    cpus: 2,
    memory_gib: 4,
    disk_gib: 24,
  });
  assert.deepEqual(configuredResources("memory: 6144MiB\n"), { memory_gib: 6 });
});

test("the VM's usage reads its guest memory when it runs, and leaves out what it cannot read", async () => {
  const meminfo = "MemTotal:        4000000 kB\nMemAvailable:    1000000 kB\n";
  assert.equal(usedFromMeminfo(meminfo), 2930);
  const running = await computerUsage({
    name: "computer",
    running: async () => true,
    assigned: () => ({ memory_gib: 4, cpus: 2 }),
    imageBytes: () => 3 * GIB,
    meminfo: async () => meminfo,
  });
  assert.deepEqual(running, {
    running: true,
    name: "computer",
    cpus: 2,
    memory_assigned_mb: 4096,
    memory_used_mb: 2930,
    disk_mb: 3072,
  });
  const silent = await computerUsage({
    name: "computer",
    running: async () => true,
    assigned: () => ({ memory_gib: 4 }),
    imageBytes: () => 0,
    meminfo: async () => {
      throw new Error("guest did not answer");
    },
  });
  assert.deepEqual(silent, { running: true, name: "computer", memory_assigned_mb: 4096 });
});

test("the guest disk's size is what it holds, read from Lima 2's `disk` or an older `diffdisk`", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-disk-"));
  try {
    assert.equal(diskImageBytes(dir), 0);
    fs.writeFileSync(path.join(dir, "diffdisk"), Buffer.alloc(64 * 1024, 1));
    assert.ok(diskImageBytes(dir) >= 64 * 1024, "an older instance's diffdisk");
    // A sparse 1 GiB file holding 64 KiB: what it holds, not its size.
    const disk = fs.openSync(path.join(dir, "disk"), "w");
    fs.writeSync(disk, Buffer.alloc(64 * 1024, 1));
    fs.ftruncateSync(disk, GIB);
    fs.closeSync(disk);
    const held = diskImageBytes(dir);
    assert.ok(held >= 64 * 1024 && held < 64 * 1024 * 1024, `held ${held}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
