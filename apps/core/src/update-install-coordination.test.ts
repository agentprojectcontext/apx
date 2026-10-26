import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createLog } from "./log.ts";
import { manualTimers, tempDir } from "./testkit/platform.ts";
import { createUpdates, type Runner } from "./updates.ts";

for (const corrupt of [false, true]) {
  test(`the production coordinator ${corrupt ? "blocks a corrupt bundle" : "installs a pinned bundle once across clients and restart"}`, async () => {
    const dir = tempDir("apx-coordinated-install-");
    const app = path.join(dir.path, "app");
    const root = path.join(app, "versions", "2.0.0");
    fs.mkdirSync(root, { recursive: true });
    const timers = manualTimers();
    let restarts = 0;
    let extracts = 0;
    const downloads: string[] = [];
    const archive = Buffer.from("test package");
    const sum = createHash("sha256")
      .update(corrupt ? "wrong package" : archive)
      .digest("hex");
    const assets = (v: string) =>
      [`apx-core-${v}-linux-x64.tar.gz`, `APX-${v}-linux-x64.AppImage`].flatMap((name) => [name, `${name}.sha256`]);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/releases?"))
        return Response.json(
          ["2.2.0", "2.1.0"].map((v) => ({
            tag_name: `v${v}`,
            assets: assets(v).map((name) => ({ name, browser_download_url: `https://example.com/${name}` })),
          })),
        );
      downloads.push(url);
      return new Response(url.endsWith(".sha256") ? sum : archive);
    };
    const run: Runner = async (_cmd, args) => {
      extracts++;
      const unpacked = args[args.indexOf("-C") + 1];
      assert.ok(unpacked);
      fs.mkdirSync(path.join(unpacked, "apx", "node", "bin"), { recursive: true });
      fs.writeFileSync(path.join(unpacked, "apx", "node", "bin", "node"), "installed runtime");
      return { code: 0, out: "" };
    };
    const make = (version: string) =>
      createUpdates({
        root,
        app,
        version,
        stateFile: path.join(dir.path, "update.json"),
        enabled: true,
        supervised: true,
        restart: () => {
          restarts++;
        },
        updateTimers: timers,
        log: createLog("test", true),
        platform: { os: "linux", arch: "x64" },
        feed: "acme/apx",
        fetch: fetchImpl,
        run,
      });
    try {
      const u = make("2.0.0");
      const request = { target: "2.1.0", desktop: { os: "linux", arch: "x64" } } as const;
      await Promise.all([u.prepare(request), u.prepare(request)]);
      const [a, b] = await Promise.all([u.apply("2.1.0"), u.apply("2.1.0")]);
      assert.deepEqual(a, b);
      assert.equal(a.ok, !corrupt);
      assert.equal(downloads.length, 2);
      assert.ok(downloads.every((url) => url.includes("2.1.0")));
      assert.equal(extracts, corrupt ? 0 : 1);
      assert.equal(u.coordination().coordination?.phase, corrupt ? "failed" : "restarting");
      assert.equal(restarts, 0);
      timers.tick(500);
      assert.equal(restarts, corrupt ? 0 : 1);
      if (!corrupt) {
        assert.equal((await u.apply()).restart, true);
        assert.equal(extracts, 1);
        assert.equal(make("2.1.0").coordination().coordination?.phase, "complete");
        const restarted = make("2.1.0");
        assert.equal((await restarted.prepare(request)).phase, "complete");
        assert.equal((await restarted.apply()).ok, true);
        assert.equal(extracts, 2);
        assert.ok(downloads.slice(2).every((url) => url.includes("2.2.0")));
      } else {
        assert.equal(fs.existsSync(path.join(app, "current")), false);
        assert.match(a.log, /does not match/);
      }
    } finally {
      await dir.remove();
    }
  });
}
