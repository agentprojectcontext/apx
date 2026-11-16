import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { assertSandboxDesktopData, coreOwnsHome, portTaken } from "../e2e/sandbox.ts";
import { desktopDataDir } from "../packages/install/src/paths.ts";

test("a desktop test refuses the APX app's own data folder and anything outside the temp folder", async () => {
  await using temp = tempDir("apx-sandbox-");
  assert.doesNotThrow(() => assertSandboxDesktopData(path.join(temp.path, "desktop", "data")));
  const machine = desktopDataDir(
    process.platform,
    { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME },
    os.homedir(),
  );
  for (const dataDir of [
    undefined,
    "",
    "desktop",
    machine,
    path.join(machine, "nested"),
    path.dirname(machine),
    path.join(os.homedir(), "apx-desktop-data"),
  ])
    assert.throws(() => assertSandboxDesktopData(dataDir), /APX_DESKTOP_DATA/, String(dataDir));
});

test("a sandbox talks only to the core whose home it made", async () => {
  await using temp = tempDir("apx-sandbox-");
  fs.writeFileSync(path.join(temp.path, "home-id"), "sandbox-home\n");
  let reported = "sandbox-home";
  const core = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { name: "apx-core", home_id: reported } }));
  });
  await new Promise<void>((resolve) => core.listen(0, "127.0.0.1", resolve));
  const port = (core.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  try {
    assert.equal(await coreOwnsHome(url, temp.path), true);
    assert.equal(await portTaken(port), true);
    // A scratch core someone left on the port: another installation.
    reported = "another-installation";
    assert.equal(await coreOwnsHome(url, temp.path), false);
    assert.equal(await coreOwnsHome(url, path.join(temp.path, "missing")), false);
  } finally {
    await new Promise<void>((resolve) => core.close(() => resolve()));
  }
  assert.equal(await coreOwnsHome(url, temp.path), false);
  assert.equal(await portTaken(port), false);
});
