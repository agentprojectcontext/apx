import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createLog } from "./log.ts";
import { panelEntry } from "./server-wiring.ts";
import { createUpdates, RESTART_CODE, type Runner, restartAfterClose } from "./updates.ts";
import { runningVersion } from "./updates-release.ts";

const log = createLog("test", true);
const checkout = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-upd-"));
  fs.mkdirSync(path.join(root, ".git"));
  return root;
};
/** Answers git and pnpm like a checkout three commits behind release/v2. */
const runner = (fail?: string): Runner & { calls: string[] } => {
  const calls: string[] = [];
  const answer = async (cmd: string, args: string[]) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    if (fail && line.startsWith(fail)) return { code: 1, out: "error: not possible to fast-forward" };
    if (args[0] === "rev-list") return { code: 0, out: "3\n" };
    if (args[0] === "rev-parse") return { code: 0, out: "abc123def456\n" };
    if (args[0] === "log") return { code: 0, out: "feat: whatsapp\nfix: dialogs\n\nfix: cards\n" };
    return { code: 0, out: "ok" };
  };
  return Object.assign(answer, { calls });
};

test("outside a checkout there is nothing to update, and an update says why", async () => {
  const u = createUpdates({ root: os.tmpdir(), log, enabled: true, supervised: false, run: runner() });
  assert.equal((await u.check()).source, "none");
  assert.deepEqual(await u.apply(), {
    ok: false,
    restart: false,
    log: "This APX updates with its desktop app, or by hand.",
  });
});

test("a check tells how far behind release/v2 the checkout is and what changed", async () => {
  const root = checkout();
  const u = createUpdates({ root, log, enabled: true, supervised: false, run: runner() });
  const s = await u.check();
  assert.equal(s.behind, 3);
  assert.equal(s.latest, "abc123def456");
  assert.deepEqual(s.changes, ["feat: whatsapp", "fix: dialogs", "fix: cards"]);
  assert.ok(s.checked_at);
  assert.deepEqual(u.status(), s);
  fs.rmSync(root, { recursive: true });
});

test("an update pulls fast-forward only, installs and builds; supervised, the core restarts", async () => {
  const root = checkout();
  const run = runner();
  let restarted = false;
  const u = createUpdates({ root, log, enabled: true, supervised: true, run, restart: () => (restarted = true) });
  const r = await u.apply();
  assert.equal(r.ok, true);
  assert.equal(r.restart, true);
  assert.deepEqual(run.calls.slice(0, 3), [
    "git pull --ff-only origin release/v2",
    "pnpm install --frozen-lockfile",
    "pnpm build:web",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(restarted, true);
  fs.rmSync(root, { recursive: true });
});

test("a pull that cannot fast-forward stops the update before installing anything", async () => {
  const root = checkout();
  const run = runner("git pull");
  const u = createUpdates({ root, log, enabled: true, supervised: true, run, restart: () => assert.fail("restarted") });
  const r = await u.apply();
  assert.equal(r.ok, false);
  assert.match(r.log, /not possible to fast-forward/);
  assert.ok(!run.calls.some((c) => c.startsWith("pnpm")));
  fs.rmSync(root, { recursive: true });
});

test("the served panel is known by its entry file, read again when the build changes", () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "apx-dist-"));
  const write = (entry: string, at: number) => {
    fs.writeFileSync(path.join(dist, "index.html"), `<script type="module" src="/assets/${entry}"></script>`);
    fs.utimesSync(path.join(dist, "index.html"), at, at);
  };
  write("index-AAA111.js", 1000);
  assert.equal(panelEntry(dist), "index-AAA111.js");
  write("index-BBB222.js", 2000);
  assert.equal(panelEntry(dist), "index-BBB222.js");
  assert.equal(panelEntry(undefined), undefined);
  fs.rmSync(dist, { recursive: true });
});

/** A bundle install (APX_APP) at 2.0.3 and a feed that serves 2.1.0 for linux-x64, the way GitHub would. */
async function releaseFeed(o: { corrupt?: boolean } = {}) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "apx-upd-app-"));
  const old = path.join(app, "versions", "2.0.3");
  fs.mkdirSync(path.join(old, "node", "bin"), { recursive: true });
  fs.writeFileSync(path.join(old, "node", "bin", "node"), "old");
  fs.mkdirSync(path.join(app, "versions", "1.9.0"));
  fs.symlinkSync(path.join("versions", "2.0.3"), path.join(app, "current"));

  const src = fs.mkdtempSync(path.join(os.tmpdir(), "apx-upd-src-"));
  fs.mkdirSync(path.join(src, "apx", "node", "bin"), { recursive: true });
  fs.writeFileSync(path.join(src, "apx", "node", "bin", "node"), "new");
  const name = "apx-core-2.1.0-linux-x64.tar.gz";
  execFileSync("tar", ["-czf", path.join(src, name), "-C", src, "apx"]);
  const tarball = fs.readFileSync(path.join(src, name));
  const digest = createHash("sha256")
    .update(o.corrupt ? "something else" : tarball)
    .digest("hex");

  const server = http.createServer((req, res) => {
    if (req.url === "/releases") return res.setHeader("content-type", "application/json").end(JSON.stringify(releases));
    if (req.url === `/${name}`) return res.end(tarball);
    if (req.url === `/${name}.sha256`) return res.end(`${digest}  ${name}\n`);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const releases = [
    {
      tag_name: "v2.1.0",
      body: "* feat: sidebar sections by @someone in https://example.com/1",
      assets: [name, `${name}.sha256`].map((n) => ({ name: n, browser_download_url: `${base}/${n}` })),
    },
    { tag_name: "v1.123.1", assets: [] },
  ];
  // The GitHub API call is the only one fetch makes to another host: answered here, downloads go to the server.
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/repos/acme/apx/releases")) return Response.json(releases);
    return fetch(input, init);
  };
  const tar: Runner = async (cmd, args) => {
    try {
      return { code: 0, out: execFileSync(cmd, args, { encoding: "utf8" }) };
    } catch (err) {
      return { code: 1, out: String(err) };
    }
  };
  const done = () => {
    server.close();
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  };
  const applyInProcess = async (root: string, env = process.env) => {
    const script = `
      import { createUpdates } from ${JSON.stringify(new URL("./updates.ts", import.meta.url).href)};
      import { createLog } from ${JSON.stringify(new URL("./log.ts", import.meta.url).href)};
      const u = createUpdates({
        root: ${JSON.stringify(root)}, app: ${JSON.stringify(app)}, log: createLog("test", true),
        enabled: true, supervised: false, version: "2.0.3", feed: "acme/apx",
        platform: { os: "linux", arch: "x64" },
        fetch: (input, init) => fetch(String(input).startsWith("https://api.github.com/")
          ? ${JSON.stringify(`${base}/releases`)} : input, init),
      });
      const result = await u.apply();
      // Ends on its own: process.exit with sockets still closing crashes Node on Windows.
      process.stdout.write(JSON.stringify(result));
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
      env,
      timeout: 20_000,
    });
    return JSON.parse(stdout) as { ok: boolean; restart: boolean; log: string };
  };
  return { app, fakeFetch, tar, done, applyInProcess };
}

test("a bundle install finds the newer release, installs it beside the running one and restarts", async () => {
  const f = await releaseFeed();
  let restarted = false;
  const u = createUpdates({
    root: os.tmpdir(),
    log,
    enabled: true,
    supervised: true,
    version: "2.0.3",
    app: f.app,
    feed: "acme/apx",
    platform: { os: "linux", arch: "x64" },
    fetch: f.fakeFetch,
    run: f.tar,
    restart: () => (restarted = true),
  });
  const s = await u.check();
  assert.equal(s.source, "release");
  assert.equal(s.behind, 1);
  assert.equal(s.latest, "2.1.0");
  assert.deepEqual(s.changes, ["feat: sidebar sections"]);

  const r = await u.apply();
  assert.equal(r.ok, true, r.log);
  assert.equal(r.restart, true);
  assert.equal(fs.readFileSync(path.join(f.app, "current", "node", "bin", "node"), "utf8"), "new");
  // The version that ran stays (to go back by hand); older ones and the download go.
  assert.deepEqual(fs.readdirSync(path.join(f.app, "versions")).sort(), ["2.0.3", "2.1.0"]);
  assert.deepEqual(
    fs.readdirSync(f.app).filter((n) => n.startsWith(".update-")),
    [],
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(restarted, true);
  f.done();
});

test("a bundle that does not match its .sha256 is refused and what runs stays as it was", async () => {
  const f = await releaseFeed({ corrupt: true });
  const u = createUpdates({
    root: os.tmpdir(),
    log,
    enabled: true,
    supervised: false,
    version: "2.0.3",
    app: f.app,
    feed: "acme/apx",
    platform: { os: "linux", arch: "x64" },
    fetch: f.fakeFetch,
    run: f.tar,
  });
  const r = await u.apply();
  assert.equal(r.ok, false);
  assert.match(r.log, /does not match its \.sha256/);
  assert.equal(fs.readFileSync(path.join(f.app, "current", "node", "bin", "node"), "utf8"), "old");
  assert.deepEqual(fs.readdirSync(path.join(f.app, "versions")).sort(), ["1.9.0", "2.0.3"]);
  f.done();
});

test("a release update runs even when the running bundle's root no longer exists", async () => {
  const f = await releaseFeed();
  try {
    const result = await f.applyInProcess(path.join(f.app, "removed-bundle"));
    assert.equal(result.ok, true, result.log);
    assert.equal(fs.readFileSync(path.join(f.app, "current", "node", "bin", "node"), "utf8"), "new");
  } finally {
    f.done();
  }
});

test("an update never deletes the version a core that did not restart still runs from", async () => {
  // current is 2.0.3, but this core started at 1.9.0 and missed a restart: pruning used to delete its own folder.
  const f = await releaseFeed();
  const root = path.join(f.app, "versions", "1.9.0");
  try {
    assert.equal(runningVersion(f.app, root), "1.9.0");
    assert.equal(runningVersion(f.app, os.tmpdir()), undefined);
    const u = createUpdates({
      root,
      log,
      enabled: true,
      supervised: false,
      version: "1.9.0",
      app: f.app,
      feed: "acme/apx",
      platform: { os: "linux", arch: "x64" },
      fetch: f.fakeFetch,
      run: f.tar,
    });
    const r = await u.apply();
    assert.equal(r.ok, true, r.log);
    assert.equal(fs.readFileSync(path.join(f.app, "current", "node", "bin", "node"), "utf8"), "new");
    assert.deepEqual(fs.readdirSync(path.join(f.app, "versions")).sort(), ["1.9.0", "2.0.3", "2.1.0"]);
  } finally {
    f.done();
  }
});

if (process.platform === "darwin") {
  test("a macOS release update uses system tar even without a service PATH", async () => {
    const f = await releaseFeed();
    try {
      const result = await f.applyInProcess(f.app, { ...process.env, PATH: "" });
      assert.equal(result.ok, true, result.log);
      assert.equal(fs.readFileSync(path.join(f.app, "current", "node", "bin", "node"), "utf8"), "new");
    } finally {
      f.done();
    }
  });
}

test("failed extraction preserves the installed versions and never requests a restart", async () => {
  const f = await releaseFeed();
  try {
    const before = fs.readlinkSync(path.join(f.app, "current"));
    const u = createUpdates({
      root: os.tmpdir(),
      app: f.app,
      log,
      enabled: true,
      supervised: true,
      version: "2.0.3",
      feed: "acme/apx",
      platform: { os: "linux", arch: "x64" },
      fetch: f.fakeFetch,
      run: async () => ({ code: 1, out: "spawn tar ENOENT" }),
      restart: () => assert.fail("restarted after failed extraction"),
    });
    const result = await u.apply();
    assert.equal(result.ok, false);
    assert.equal(result.restart, false);
    assert.match(result.log, /unpacking .*spawn tar ENOENT/);
    assert.equal(fs.readlinkSync(path.join(f.app, "current")), before);
    assert.deepEqual(fs.readdirSync(path.join(f.app, "versions")).sort(), ["1.9.0", "2.0.3"]);
    assert.deepEqual(
      fs.readdirSync(f.app).filter((name) => name.startsWith(".update-")),
      [],
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
  } finally {
    f.done();
  }
});

test("without a bundle install or a checkout, updates belong to the desktop app", async () => {
  const u = createUpdates({
    root: os.tmpdir(),
    log,
    enabled: true,
    supervised: false,
    version: "2.0.3",
    feed: "acme/apx",
  });
  assert.equal((await u.check()).source, "none");
  assert.equal((await u.apply()).ok, false);
});

test("the core the desktop app carries says a newer release is out, and leaves installing it to the app", async () => {
  const f = await releaseFeed();
  const u = createUpdates({
    root: os.tmpdir(),
    log,
    enabled: true,
    supervised: true,
    version: "2.0.3",
    byApp: true,
    feed: "acme/apx",
    platform: { os: "linux", arch: "x64" },
    fetch: f.fakeFetch,
    run: f.tar,
    restart: () => assert.fail("restarted"),
  });
  const s = await u.check();
  assert.equal(s.source, "app");
  assert.equal(s.behind, 1);
  assert.equal(s.latest, "2.1.0");
  assert.deepEqual(s.changes, ["feat: sidebar sections"]);
  const r = await u.apply();
  assert.equal(r.ok, false);
  assert.match(r.log, /desktop app/);
  f.done();
});

test("a restart after an update exits even when closing the core hangs", async () => {
  const codes: number[] = [];
  await restartAfterClose(
    () => new Promise(() => {}),
    (code) => codes.push(code),
    20,
  );
  assert.deepEqual(codes, [RESTART_CODE]);
  // A close that finishes, or fails, exits right after it.
  await restartAfterClose(
    async () => {},
    (code) => codes.push(code),
    60_000,
  );
  await restartAfterClose(
    () => Promise.reject(new Error("mcp")),
    (code) => codes.push(code),
    60_000,
  );
  assert.deepEqual(codes, [RESTART_CODE, RESTART_CODE, RESTART_CODE]);
});
