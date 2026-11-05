import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CHROME_EXTENSION_ORIGIN, CHROME_HOST } from "@apx/protocol";
import { samePath } from "../paths.ts";
import { tempDir } from "../testkit/platform.ts";
import { browserDataDirs, installChromeHost } from "./chrome-host.ts";

test("the host is registered only in browsers that are here, for APX's extension alone", async () => {
  await using root = tempDir("apx-chrome-host-");
  const home = path.join(root.path, "apx home");
  const chrome = path.join(root.path, "Chrome");
  const brave = path.join(root.path, "Brave");
  fs.mkdirSync(chrome, { recursive: true });
  const main = path.join(root.path, "main.ts");
  fs.writeFileSync(main, "");
  const install = (port = 7444) =>
    installChromeHost({
      home,
      port,
      runner: { exe: "/opt/node's/bin/node", main, electron: false },
      browsers: [chrome, brave],
      platform: "darwin",
    });

  const written = install();
  const manifestFile = path.join(chrome, "NativeMessagingHosts", `${CHROME_HOST}.json`);
  assert.equal(written.length, 1);
  assert.ok(samePath(written[0] ?? "", manifestFile));
  assert.equal(fs.existsSync(brave), false, "a browser that is not installed gets nothing");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.deepEqual(manifest.allowed_origins, [CHROME_EXTENSION_ORIGIN]);
  assert.equal(manifest.type, "stdio");
  assert.equal(manifest.name, CHROME_HOST);
  assert.ok(path.isAbsolute(manifest.path));

  const launcher = fs.readFileSync(manifest.path, "utf8");
  if (process.platform !== "win32") assert.equal(fs.statSync(manifest.path).mode & 0o111, 0o111, "Chrome can run it");
  assert.match(launcher, /export APX_PORT=7444/);
  assert.match(launcher, /export APX_HOME='.*apx home'/);
  // A quote in a path stays inside the shell's quoting.
  assert.match(launcher, /exec '\/opt\/node'\\''s\/bin\/node' .* chrome-host "\$@"/);
  assert.doesNotMatch(launcher, /TOKEN/, "the core's token is never written there");

  // Started again on another port, the launcher follows; nothing else changes.
  const before = fs.statSync(manifestFile).mtimeMs;
  install(7450);
  assert.match(fs.readFileSync(manifest.path, "utf8"), /export APX_PORT=7450/);
  assert.equal(fs.statSync(manifestFile).mtimeMs, before);
});

test("nothing is registered without a terminal to start or on Windows", async () => {
  await using root = tempDir("apx-chrome-host-none-");
  const chrome = path.join(root.path, "Chrome");
  fs.mkdirSync(chrome);
  const runner = { exe: process.execPath, main: path.join(root.path, "missing.ts"), electron: false };
  assert.deepEqual(installChromeHost({ home: root.path, port: 7440, runner, browsers: [chrome] }), []);
  fs.writeFileSync(runner.main, "");
  assert.deepEqual(
    installChromeHost({ home: root.path, port: 7440, runner, browsers: [chrome], platform: "win32" }),
    [],
  );
});

test("each platform names where its Chrome-family browsers look", () => {
  const home = path.join(path.sep, "home", "acme");
  assert.ok(
    browserDataDirs(home, "darwin").some((d) =>
      samePath(d, path.join(home, "Library", "Application Support", "Google", "Chrome")),
    ),
  );
  assert.ok(browserDataDirs(home, "linux").some((d) => samePath(d, path.join(home, ".config", "google-chrome"))));
  assert.deepEqual(browserDataDirs(home, "win32"), []);
});
