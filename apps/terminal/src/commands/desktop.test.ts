import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { desktopCandidates, localDesktopTarget } from "./desktop.ts";

test("the desktop app is looked for where each installer puts it", () => {
  assert.deepEqual(desktopCandidates("darwin", {}, "/Users/user"), [
    "/Applications/APX.app",
    "/Users/user/Applications/APX.app",
  ]);
  const installed = [
    "C:\\Users\\u\\AppData\\Local\\Programs\\apx\\APX.exe",
    "C:\\Users\\u\\AppData\\Local\\Programs\\@apxdesktop\\APX.exe",
  ];
  assert.deepEqual(
    desktopCandidates("win32", { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "C:\\Users\\u"),
    installed,
  );
  assert.deepEqual(desktopCandidates("win32", {}, "C:\\Users\\u"), installed);
  assert.deepEqual(desktopCandidates("linux", {}, "/home/u"), ["/home/u/Applications/APX.AppImage"]);
});

test("desktop handoff refuses a port belonging to another home", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-desktop-cli-"));
  fs.writeFileSync(path.join(home, "home-id"), "selected-home");
  let identity = "other-home";
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: { home_id: identity } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const env = { APX_HOME: home, APX_PORT: String(address.port) };
  try {
    await assert.rejects(localDesktopTarget(env), /another installation/);
    identity = "selected-home";
    assert.equal((await localDesktopTarget(env))?.home_id, "selected-home");
    assert.equal(await localDesktopTarget({ ...env, APX_URL: "https://remote.example" }), undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
