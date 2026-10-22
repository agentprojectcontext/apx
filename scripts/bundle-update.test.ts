// An installed APX updated the way people update it: bundles laid out as releases ship them, served by the local
// feed, a core started through `current` as the service starts it, and `apx upgrade` run twice. The unit tests fake
// the folder a core runs from; here it is the real version folder, which an update must never take from under it.
import assert from "node:assert/strict";
import { type ChildProcess, execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { coreBundleName, platformOf } from "../packages/protocol/src/releases.ts";

const root = path.resolve(import.meta.dirname, "..");
const terminal = path.join(root, "apps/terminal/src/main.ts");
const platform = platformOf(process.platform, process.arch);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "apx-bundle-update-"));
const children: ChildProcess[] = [];
after(async () => {
  await Promise.all(children.map(stop));
  if (!process.env.KEEP_BUNDLE_TEST) fs.rmSync(work, { recursive: true, force: true });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

async function waitFor<T>(what: string, get: () => Promise<T | undefined>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  });
}

/**
 * A core bundle for `version` in `out`, laid out as `pnpm package` lays one out (Node, apps/core, packages, the
 * panel, build.json), with its .sha256. Node and the dependencies are this checkout's, linked rather than copied.
 */
function publish(out: string, version: string): void {
  const src = path.join(work, `src-${path.basename(out)}-${version}`, "apx");
  fs.mkdirSync(path.join(src, "node", "bin"), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(src, "node", "bin", "node"));
  fs.cpSync(path.join(root, "apps/core/src"), path.join(src, "apps/core/src"), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "apps/core/package.json"), "utf8")) as object;
  fs.writeFileSync(path.join(src, "apps/core/package.json"), JSON.stringify({ ...pkg, version }));
  fs.symlinkSync(path.join(root, "apps/core/node_modules"), path.join(src, "apps/core/node_modules"));
  fs.symlinkSync(path.join(root, "packages"), path.join(src, "packages"));
  fs.mkdirSync(path.join(src, "apps/web/dist"), { recursive: true });
  fs.writeFileSync(path.join(src, "apps/web/dist/index.html"), `<!doctype html><title>Panel ${version}</title>`);
  fs.writeFileSync(path.join(src, "build.json"), JSON.stringify({ version, sha: `bundle-${version}` }));
  fs.mkdirSync(out, { recursive: true });
  const name = coreBundleName(version, platform ?? { os: "linux", arch: "x64" });
  execFileSync("tar", ["-czf", path.join(out, name), "-C", path.dirname(src), "apx"]);
  const digest = createHash("sha256")
    .update(fs.readFileSync(path.join(out, name)))
    .digest("hex");
  fs.writeFileSync(path.join(out, `${name}.sha256`), `${digest}  ${name}\n`);
}

/** What install.sh leaves: the bundle unpacked as versions/<version>, `current` pointing at it. */
function install(app: string, out: string, version: string): void {
  const name = coreBundleName(version, platform ?? { os: "linux", arch: "x64" });
  const unpacked = path.join(work, `unpacked-${path.basename(app)}`);
  fs.mkdirSync(unpacked, { recursive: true });
  execFileSync("tar", ["-xzf", path.join(out, name), "-C", unpacked]);
  fs.mkdirSync(path.join(app, "versions"), { recursive: true });
  fs.renameSync(path.join(unpacked, "apx"), path.join(app, "versions", version));
  fs.symlinkSync(path.join("versions", version), path.join(app, "current"));
}

async function startFeed(out: string): Promise<string> {
  const port = await freePort();
  const feed = spawn(process.execPath, [path.join(root, "scripts/install/feed.ts"), out, "--port", String(port)], {
    stdio: "ignore",
  });
  children.push(feed);
  const url = `http://127.0.0.1:${port}`;
  await waitFor("the feed", async () => ((await fetch(`${url}/releases`)).ok ? true : undefined));
  return url;
}

/** An installed APX with its own home, feed and port. */
async function setup(name: string) {
  const out = path.join(work, `${name}-feed`);
  const app = path.join(work, `${name}-app`);
  const home = path.join(work, `${name}-home`);
  publish(out, "1.0.0");
  install(app, out, "1.0.0");
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("APX_"))),
    APX_APP: app,
    APX_HOME: home,
    APX_PORT: String(port),
    APX_RELEASES: await startFeed(out),
    APX_SECRETS: "file",
    APX_NEWS: "off",
    APX_TELEMETRY: "off",
  };
  const base = `http://127.0.0.1:${port}`;
  const health = () =>
    fetch(`${base}/health`)
      .then((r) => r.json() as Promise<{ result: { version: string; code_sha: string } }>)
      .then((h) => h.result);
  /** Serves the panel of the version it runs: from that version's own folder. */
  const panel = () => fetch(`${base}/`).then(async (r) => `${r.status} ${await r.text()}`);
  const upgrade = async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [terminal, "upgrade", "--json"], {
      env,
      timeout: 60_000,
    });
    return JSON.parse(stdout) as { ok: boolean; restart: boolean; log: string };
  };
  const running = (version: string) =>
    waitFor(`the core at ${version}`, async () => ((await health()).version === version ? true : undefined));
  const versions = () => fs.readdirSync(path.join(app, "versions")).sort();
  return { out, app, env, health, panel, upgrade, running, versions };
}

// Windows runs the core from a junction and has no symlinked Node to lay out: the unit tests cover it there.
if (process.platform !== "win32") {
  test("an installed APX run as a service updates twice and restarts on the new code each time", async () => {
    const a = await setup("service");
    // `apx service run` is the supervisor: it starts the core through `current` and again whenever it exits.
    const service = spawn(process.execPath, [terminal, "service", "run", "--home", String(a.env.APX_HOME)], {
      env: a.env,
      stdio: "ignore",
    });
    children.push(service);
    await a.running("1.0.0");

    publish(a.out, "1.1.0");
    const first = await a.upgrade();
    assert.equal(first.ok, true, first.log);
    assert.equal(first.restart, true);
    await a.running("1.1.0");
    assert.match(await a.panel(), /^200 .*Panel 1\.1\.0/);

    publish(a.out, "1.2.0");
    const second = await a.upgrade();
    assert.equal(second.ok, true, second.log);
    await a.running("1.2.0");
    assert.match(await a.panel(), /^200 .*Panel 1\.2\.0/);
    assert.deepEqual(a.versions(), ["1.1.0", "1.2.0"]);
    await stop(service);
  });

  test("a core that misses its restart keeps working across two updates, and a third still installs", async () => {
    const a = await setup("unrestarted");
    // Not supervised: an update installs and asks for a restart nobody does, as a core whose restart did not happen.
    const current = path.join(a.app, "current");
    const core = spawn(
      path.join(current, "node/bin/node"),
      ["--disable-warning=ExperimentalWarning", path.join(current, "apps/core/src/main.ts")],
      { cwd: current, env: a.env, stdio: "ignore" },
    );
    children.push(core);
    await a.running("1.0.0");

    for (const version of ["1.1.0", "1.2.0"]) {
      publish(a.out, version);
      const r = await a.upgrade();
      assert.equal(r.ok, true, r.log);
      assert.equal(r.restart, false);
    }
    // Still 1.0.0, and still able to serve what lives in its own folder.
    assert.equal((await a.health()).version, "1.0.0");
    assert.match(await a.panel(), /^200 .*Panel 1\.0\.0/);
    assert.ok(a.versions().includes("1.0.0"), `1.0.0 was pruned under the running core: ${a.versions().join(", ")}`);

    publish(a.out, "1.3.0");
    const third = await a.upgrade();
    assert.equal(third.ok, true, third.log);
    assert.equal(fs.realpathSync(current), fs.realpathSync(path.join(a.app, "versions", "1.3.0")));
    await stop(core);
  });
}
