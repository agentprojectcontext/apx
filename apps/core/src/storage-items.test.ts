// Deleting one by one from Settings › Storage: the agents' computers (only while off, through the computer's own
// teardown, only by an id the core listed) and the backup copies (never core.env, never what is not a copy).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { testConfig } from "./config.ts";
import { createVmLifecycle } from "./environments/lifecycle.ts";
import { createCore } from "./server.ts";
import { createStorageItems, type ManagedComputer } from "./storage-items.ts";
import { removeDir, type TempDir, tempDir } from "./testkit/platform.ts";

const KB = 1024;
const GB = KB * KB * KB;
const LIMITS = { maxEntries: 10_000, deadlineMs: 60_000 };

let dir: TempDir;
before(() => {
  dir = tempDir("apx-storage-items-");
});
after(async () => {
  await dir.remove();
});

let n = 0;
function home(): string {
  const h = path.join(dir.path, `home-${++n}`);
  fs.mkdirSync(h, { recursive: true });
  return h;
}

function write(h: string, rel: string, bytes: number, at?: Date): string {
  const p = path.join(h, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  if (at) fs.utimesSync(p, at, at);
  return p;
}

/** The agents' VM as the computer's code would report it, with a teardown that records it ran. */
function fakeComputer(h: string, phase: string) {
  const state = { phase, removed: 0 };
  const computer: ManagedComputer = {
    limaHome: path.join(h, "computer", "lima"),
    instance: "computer",
    phase: async () => state.phase,
    remove: async () => {
      state.removed++;
      await removeDir(path.join(h, "computer", "lima", "computer"));
    },
    lastStop: () => JSON.stringify({ reason: "idle", at: "2026-10-30T10:00:00.000Z" }),
  };
  return { computer, state };
}

test("the computers list: the agents' VM and each lab, with size, whether on, and last use", async () => {
  const h = home();
  write(h, "computer/lima/computer/disk", 64 * KB);
  write(h, "computer/lima/computer/lima.yaml", KB);
  write(h, "computer/lima-2.2.1/bin/limactl", 8 * KB);
  write(h, "labs/apx-vm-lab-demo/lima/apx-lab/disk", 32 * KB, new Date("2026-09-01T00:00:00Z"));
  write(h, "labs/apx-vm-lab-demo/lima/apx-lab/ha.pid", 1, new Date("2026-09-02T00:00:00Z"));
  fs.writeFileSync(path.join(h, "labs/apx-vm-lab-demo/lima/apx-lab/ha.pid"), "4242\n");
  fs.utimesSync(
    path.join(h, "labs/apx-vm-lab-demo/lima/apx-lab/ha.pid"),
    new Date("2026-09-02T00:00:00Z"),
    new Date("2026-09-02T00:00:00Z"),
  );
  write(h, "labs/old-lab/lima/x/disk", 4 * KB);
  const { computer } = fakeComputer(h, "stopped");
  const items = createStorageItems({ home: h, computer, limits: LIMITS, alive: (pid) => pid === 4242 });
  const list = await items.listComputers();
  assert.deepEqual(
    list.map((c) => [c.id, c.kind, c.on]),
    [
      ["agents:computer", "agents", false],
      ["lab:apx-vm-lab-demo", "lab", true],
      ["lab:old-lab", "lab", false],
    ],
  );
  const [agents, lab] = list;
  assert.ok((agents?.bytes ?? 0) >= 65 * KB, "the VM's folder");
  assert.ok((agents?.bytes ?? 0) < 73 * KB, "not Lima's own program beside it");
  assert.equal(agents?.last_used_at, "2026-10-30T10:00:00.000Z", "when it was last turned off");
  assert.equal(agents?.can_turn_off, undefined, "off: nothing to turn off");
  assert.ok((lab?.bytes ?? 0) >= 32 * KB);
  assert.equal(lab?.last_used_at, "2026-09-02T00:00:00.000Z");

  const running = fakeComputer(h, "running");
  const on = await createStorageItems({ home: h, computer: running.computer, limits: LIMITS }).listComputers();
  assert.equal(on[0]?.on, true);
  assert.equal(on[0]?.can_turn_off, true);
  assert.equal(on[0]?.last_used_at, undefined, "in use now");
});

test("a computer that is on, starting or stopping is never deleted", async () => {
  const h = home();
  const disk = write(h, "computer/lima/computer/disk", 8 * KB);
  const lab = write(h, "labs/demo/lima/apx-lab/disk", 8 * KB);
  fs.writeFileSync(path.join(h, "labs/demo/lima/apx-lab/ha.pid"), "4242\n");
  for (const phase of ["running", "preparing", "stopping"]) {
    const { computer, state } = fakeComputer(h, phase);
    const items = createStorageItems({ home: h, computer, limits: LIMITS, alive: () => true });
    await assert.rejects(items.deleteComputer("agents:computer"), /turn it off first/, phase);
    await assert.rejects(items.deleteComputer("lab:demo"), /turn it off first/);
    assert.equal(state.removed, 0);
  }
  assert.ok(fs.existsSync(disk) && fs.existsSync(lab));
});

test("a delete names a listed id only: never a path, another instance or a folder outside", async () => {
  const h = home();
  write(h, "computer/lima/computer/disk", 8 * KB);
  const other = write(h, "computer/lima/other/disk", 8 * KB);
  const outside = write(dir.path, `outside-${n}/labs/x/disk`, 8 * KB);
  const db = write(h, "apx.db", KB);
  const { computer, state } = fakeComputer(h, "stopped");
  let changed = 0;
  const items = createStorageItems({ home: h, computer, limits: LIMITS, changed: () => changed++ });
  for (const id of ["agents:other", "lab:../..", "lab:..", `lab:${path.dirname(path.dirname(outside))}`, "apx.db", ""])
    await assert.rejects(items.deleteComputer(id), /not found/, id);
  assert.ok(fs.existsSync(other) && fs.existsSync(outside) && fs.existsSync(db));
  assert.equal(changed, 0);

  const r = await items.deleteComputer("agents:computer");
  assert.equal(state.removed, 1, "through the computer's own teardown");
  assert.ok(r.freed_bytes >= 8 * KB);
  assert.equal(changed, 1, "measured again, and the panel hears");
  assert.ok(fs.existsSync(other), "another instance's folder stays");

  write(h, "labs/demo/lima/apx-lab/disk", 8 * KB);
  await items.deleteComputer("lab:demo");
  assert.ok(!fs.existsSync(path.join(h, "labs", "demo")));
  assert.ok(fs.existsSync(path.join(h, "labs")), "the labs folder itself stays");
});

test("backups: only copies of the database, with their -wal beside them; never core.env", async (t) => {
  const h = home();
  write(h, "backups/apx-before-reimport.db", 8 * KB, new Date("2026-10-04T21:16:00Z"));
  write(h, "backups/apx-before-reimport.db-wal", 4 * KB);
  write(h, "backups/apx-before-in-apps.db", 16 * KB, new Date("2026-10-31T21:15:00Z"));
  const env = write(h, "backups/core.env", 200);
  const notes = write(h, "backups/notes.txt", 100);
  write(h, "backups/nested/old.db", KB);
  const target = write(dir.path, `elsewhere-${n}/real.db`, KB);
  try {
    fs.symlinkSync(target, path.join(h, "backups", "linked.db"));
  } catch (err) {
    t.diagnostic(`no links here: ${String(err)}`);
  }
  const items = createStorageItems({ home: h, limits: LIMITS });
  const list = items.listBackups();
  assert.deepEqual(
    list.map((b) => [b.id, b.bytes, b.created_at]),
    [
      ["apx-before-in-apps.db", 16 * KB, "2026-10-31T21:15:00.000Z"],
      ["apx-before-reimport.db", 12 * KB, "2026-10-04T21:16:00.000Z"],
    ],
    "newest first; the copy's -wal counted with it",
  );
  for (const id of ["core.env", "notes.txt", "nested/old.db", "linked.db", "../apx.db"])
    assert.throws(() => items.deleteBackup(id), /not found/, id);
  assert.ok(fs.existsSync(env) && fs.existsSync(notes) && fs.existsSync(target));

  assert.equal(items.deleteBackup("apx-before-reimport.db").freed_bytes, 12 * KB);
  assert.ok(!fs.existsSync(path.join(h, "backups", "apx-before-reimport.db-wal")), "its -wal goes with it");
  assert.deepEqual(
    items.listBackups().map((b) => b.id),
    ["apx-before-in-apps.db"],
  );
  assert.ok(fs.existsSync(env), "core.env stays");
});

test("the lifecycle deletes the VM only while off and outside any other operation", async () => {
  let running = true;
  let removed = 0;
  let release: () => void = () => {};
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => running,
    prepare: () =>
      new Promise<void>((r) => {
        release = r;
      }),
    stop: async () => {
      running = false;
    },
    appearance: async () => {},
    remove: async () => {
      removed++;
    },
  });
  await assert.rejects(lifecycle.remove(), /turn it off first/);
  running = false;
  lifecycle.start("light");
  await assert.rejects(lifecycle.remove(), /starting or stopping/);
  release();
  await lifecycle.stop();
  assert.equal(removed, 0);
  await lifecycle.close();
  const off = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => false,
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
    remove: async () => {
      removed++;
    },
  });
  assert.equal((await off.status()).phase, "stopped");
  await off.remove();
  assert.equal(removed, 1);

  // A start that begins while the guest is asked whether it runs wins: the delete is refused.
  let answer: (on: boolean) => void = () => {};
  const racing = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: () =>
      new Promise<boolean>((r) => {
        answer = r;
      }),
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
    remove: async () => {
      removed++;
    },
  });
  const removing = racing.remove();
  racing.start("light");
  answer(false);
  await assert.rejects(removing, /starting or stopping/);
  assert.equal(removed, 1);
  await racing.close();
});

test("through the protocol: list and delete computers and backups, refused while on", async () => {
  const h = home();
  write(h, "computer/lima/computer/disk", 16 * KB);
  write(h, "backups/apx-before.db", 8 * KB);
  write(h, "backups/core.env", 100);
  let running = true;
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => fs.existsSync(path.join(h, "computer", "lima", "computer")),
    running: async () => running,
    prepare: async () => {},
    stop: async () => {
      running = false;
    },
    appearance: async () => {},
    remove: async () => {
      await removeDir(path.join(h, "computer", "lima", "computer"));
    },
  });
  let changed = 0;
  const core = await createCore(testConfig({ home: h }), {
    quiet: true,
    computer: { limaHome: path.join(h, "computer", "lima"), instance: "computer", lifecycle },
    // A plenty disk: on a nearly full machine the low-disk check would tell the panel too.
    storageDisk: async () => ({ free: 1024 * GB, total: 2048 * GB }),
  });
  const off = core.bus.on((e) => {
    if (e.type === "storage.changed") changed++;
  });
  try {
    const owner = new ApxClient({ url: core.url });
    const { computers } = await owner.call("storage.computers.list", {});
    assert.deepEqual(
      computers.map((c) => [c.id, c.on, c.can_turn_off]),
      [["agents:computer", true, true]],
    );
    await assert.rejects(owner.call("storage.computers.delete", { id: "agents:computer" }), /turn it off first/);
    running = false;
    assert.equal((await owner.call("storage.computers.list", {})).computers[0]?.on, false);
    const r = await owner.call("storage.computers.delete", { id: "agents:computer" });
    assert.ok(r.freed_bytes >= 16 * KB);
    assert.deepEqual((await owner.call("storage.computers.list", {})).computers, []);

    const { backups } = await owner.call("storage.backups.list", {});
    assert.deepEqual(
      backups.map((b) => b.id),
      ["apx-before.db"],
    );
    await assert.rejects(owner.call("storage.backups.delete", { id: "core.env" }), /not found/);
    await owner.call("storage.backups.delete", { id: "apx-before.db" });
    assert.ok(!fs.existsSync(path.join(h, "backups", "apx-before.db")));
    assert.ok(fs.existsSync(path.join(h, "backups", "core.env")));
    assert.equal(changed, 2, "each delete tells the panel");
  } finally {
    off();
    await core.close();
  }
});
