import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { removeDir, tempDir } from "../testkit/platform.ts";
import {
  configuredResources,
  defaultResources,
  diskRefusal,
  limaCreateArgs,
  limaEditArgs,
  refusalText,
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
  const refused = startRefusal(r, 5.5 * GIB);
  // The numbers, for the panel to say in each language, and the VM memory that would start now.
  assert.deepEqual(refused, { reason: "memory", free_gib: 5.5, vm_gib: 4, reserve_gib: 2, fits_gib: 3, anyway: true });
  assert.match(refused ? refusalText(refused) : "", /5\.5 GiB free, the VM needs 4 GiB plus 2 GiB.+memory to 3 GiB/);
  // Nothing smaller than the least a VM may have would start either: no offer to lower it.
  assert.equal(startRefusal(r, 3.5 * GIB)?.fits_gib, undefined);
  // The owner's "start anyway" asks only for the VM's own memory, never less.
  assert.equal(startRefusal(r, 5.5 * GIB, 2, true), undefined);
  assert.equal(startRefusal(r, 3.5 * GIB)?.anyway, undefined, "not even the VM's memory is free");
  assert.ok(startRefusal(r, 3.5 * GIB, 2, true));
});

test("the guest disk needs room to grow to its size plus the reserve, counting what it already holds", () => {
  assert.equal(diskRefusal(24, 0, 26 * GIB), undefined);
  assert.match(diskRefusal(24, 0, 25 * GIB) ?? "", /needs 26 GiB free .*24 GiB guest disk/);
  assert.equal(diskRefusal(24, 20 * GIB, 6 * GIB), undefined, "only the 4 GiB it still grows count");
  assert.match(diskRefusal(24, 20 * GIB, 5 * GIB) ?? "", /needs 6 GiB free/);
  assert.equal(diskRefusal(24, 30 * GIB, 2 * GIB), undefined, "a disk already past its size grows no more");
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

test("the guest disk's size is what it holds, read from Lima 2's `disk` or an older `diffdisk`", async () => {
  const dir = tempDir("apx-vm-disk-").path;
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
    assert.equal(held, fs.statSync(path.join(dir, "disk")).blocks * 512, "what the filesystem holds for it");
    // NTFS keeps no holes in a file unless asked to; APFS and ext4 do, and there it is far below its size.
    if (process.platform !== "win32") assert.ok(held >= 64 * 1024 && held < 64 * 1024 * 1024, `held ${held}`);
  } finally {
    await removeDir(dir);
  }
});
