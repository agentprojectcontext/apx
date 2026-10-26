import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Release } from "@apx/protocol";
import { tempDir } from "./testkit/platform.ts";
import { createUpdateCoordination } from "./update-coordination.ts";

const desktop = { os: "mac", arch: "arm64" } as const;
const names = (v: string) =>
  [`apx-core-${v}-linux-x64.tar.gz`, `APX-${v}-mac-arm64.zip`].flatMap((n) => [n, `${n}.sha256`]);
const releases = (versions = ["2.2.0", "2.1.0"], omit?: string) =>
  versions.map((v) => ({
    tag_name: `v${v}`,
    assets: names(v)
      .filter((n) => n !== omit)
      .map((name) => ({ name, browser_download_url: `https://example.com/${name}` })),
  }));
const request = { target: "2.1.0", desktop, format: "zip" } as const;

async function fixture() {
  const dir = tempDir("apx-coordination-");
  const file = path.join(dir.path, "update.json");
  const installed: Release[] = [];
  let list = releases();
  let clock = 1000;
  let fail = false;
  let hold: Promise<void> = Promise.resolve();
  const create = (version = "2.0.0", supported = true) =>
    createUpdateCoordination({
      version,
      file,
      supported,
      platform: { os: "linux", arch: "x64" },
      feed: "acme/apx",
      fetch: async () => Response.json(list),
      now: () => clock,
      install: async (r) => {
        installed.push(r);
        await hold;
        return { ok: !fail, restart: !fail, log: fail ? "checksum mismatch" : "installed" };
      },
    });
  return {
    dir,
    file,
    installed,
    create,
    omit: (name: string) => {
      list = releases(undefined, name);
    },
    fail: () => {
      fail = true;
    },
    tick: (ms: number) => {
      clock += ms;
    },
    hold: () => {
      let release = () => {};
      hold = new Promise<void>((r) => {
        release = r;
      });
      return release;
    },
  };
}

test("two clients share one exact install, not the latest release or a second restart", async () => {
  const f = await fixture();
  try {
    const u = f.create();
    const plans = await Promise.all([u.prepare(request), u.prepare(request)]);
    assert.deepEqual(
      plans.map((p) => p.target),
      ["2.1.0", "2.1.0"],
    );
    const release = f.hold();
    const first = u.apply("2.1.0");
    const second = u.apply("2.1.0");
    assert.equal(first, second);
    assert.equal(u.state().coordination?.phase, "installing");
    release();
    const result = await first;
    assert.equal(result.ok, true);
    assert.deepEqual(
      f.installed.map((r) => r.version),
      ["2.1.0"],
    );
    assert.equal((await u.apply("2.1.0")).restart, true);
    assert.equal(f.installed.length, 1);
    await assert.rejects(u.prepare({ ...request, target: "2.2.0" }), /already the shared/);
  } finally {
    await f.dir.remove();
  }
});

test("restart and offline reconnect only confirm the exact running target", async () => {
  const f = await fixture();
  try {
    const old = f.create();
    await old.prepare(request);
    await old.apply(request.target);
    assert.equal(old.state().coordination?.phase, "restarting");
    const wrong = f.create("2.0.0");
    assert.equal(wrong.state().coordination?.phase, "failed");
    const target = f.create("2.1.0");
    assert.equal(target.state().coordination?.phase, "complete");
    assert.equal(target.state().running, "2.1.0");
    assert.equal((await target.prepare(request)).phase, "complete");
    assert.equal((await target.apply(request.target)).restart, false);
    assert.equal(f.installed.length, 1);
    const offlineClient = f.create("2.1.0");
    assert.deepEqual(offlineClient.state(), target.state());
  } finally {
    await f.dir.remove();
  }
});

test("server failure persists and blocks application until explicitly prepared again", async () => {
  const f = await fixture();
  try {
    const u = f.create();
    await u.prepare(request);
    f.fail();
    assert.equal((await u.apply(request.target)).ok, false);
    assert.equal(f.create().state().coordination?.phase, "failed");
    assert.match((await u.apply(request.target)).log, /checksum mismatch/);
    assert.equal(f.installed.length, 1);
  } finally {
    await f.dir.remove();
  }
});

test("both platform assets and mandatory checksums are validated before recording intent", async () => {
  const f = await fixture();
  try {
    f.omit("APX-2.1.0-mac-arm64.zip.sha256");
    const u = f.create();
    await assert.rejects(u.prepare(request), /no Desktop package with a checksum/);
    assert.equal(u.state().coordination, null);
    f.omit("apx-core-2.1.0-linux-x64.tar.gz");
    await assert.rejects(u.prepare(request), /no core bundle with a checksum/);
    assert.equal(fs.existsSync(f.file), false);
    assert.equal(f.installed.length, 0);
  } finally {
    await f.dir.remove();
  }
});

test("unsupervised or bundled cores and unprepared or downgraded targets cannot be coordinated", async () => {
  const f = await fixture();
  try {
    const unsupported = f.create("2.0.0", false);
    assert.equal(unsupported.state().supported, false);
    await assert.rejects(unsupported.prepare(request), /cannot coordinate/);
    const u = f.create("2.2.0");
    await assert.rejects(u.prepare(request), /cannot downgrade/);
    assert.equal((await u.apply(request.target)).ok, false);
    assert.equal(f.installed.length, 0);
  } finally {
    await f.dir.remove();
  }
});

test("interrupted installs become failed, while prepared intent survives a process restart", async () => {
  const f = await fixture();
  try {
    const u = f.create();
    await u.prepare(request);
    assert.equal(f.create().state().coordination?.phase, "prepared");
    const release = f.hold();
    const pending = u.apply(request.target);
    assert.equal(f.create().state().coordination?.phase, "failed");
    release();
    await pending;
  } finally {
    await f.dir.remove();
  }
});

test("corrupt persisted intent blocks updates without preventing the core from starting", async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(f.file, "not JSON");
    const u = f.create();
    assert.equal(u.state().supported, false);
    assert.match(u.state().error ?? "", /cannot be read/);
    await assert.rejects(u.prepare(request), /cannot coordinate/);
    assert.equal((await u.apply(request.target)).ok, false);
    assert.equal(fs.readFileSync(f.file, "utf8"), "not JSON");
  } finally {
    await f.dir.remove();
  }
});

test("a failed supervisor reaches a terminal failure on the injected restart deadline", async () => {
  const f = await fixture();
  try {
    const u = f.create();
    await u.prepare(request);
    await u.apply(request.target);
    f.tick(5 * 60_000);
    assert.equal(u.state().coordination?.phase, "failed");
    assert.match(u.state().coordination?.error ?? "", /deadline/);
  } finally {
    await f.dir.remove();
  }
});
