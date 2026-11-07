import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { CHROME_EXTENSION_ID } from "@apx/protocol";
import { tempDir } from "../testkit/platform.ts";
import { hasApxExtension, openOwnersChrome } from "./chrome-launch.ts";

function browser(root: string, dir: string, prefs?: { profile: string; file: string; text: string }) {
  const data = path.join(root, ...dir.split("/"));
  fs.mkdirSync(data, { recursive: true });
  if (prefs) {
    fs.mkdirSync(path.join(data, prefs.profile), { recursive: true });
    fs.writeFileSync(path.join(data, prefs.profile, prefs.file), prefs.text);
  }
  return data;
}

test("only the browser whose profile has APX's extension is opened, Chrome before the others", async () => {
  await using root = tempDir("apx-chrome-launch-");
  const withIt = `{"extensions":{"settings":{"${CHROME_EXTENSION_ID}":{"state":1}}}}`;
  const chrome = browser(root.path, "Google/Chrome", { profile: "Default", file: "Preferences", text: "{}" });
  const brave = browser(root.path, "BraveSoftware/Brave-Browser", {
    profile: "Profile 2",
    file: "Secure Preferences",
    text: withIt,
  });
  assert.equal(hasApxExtension(chrome), false);
  assert.equal(hasApxExtension(brave), true);
  assert.equal(hasApxExtension(path.join(root.path, "missing")), false);

  const ran: string[][] = [];
  const run = async (cmd: string, args: string[]) => {
    ran.push([cmd, ...args]);
  };
  assert.equal(await openOwnersChrome({ browsers: [chrome, brave], platform: "darwin", run }), "opened");
  assert.deepEqual(ran, [["open", "-b", "com.brave.Browser"]]);

  fs.writeFileSync(path.join(chrome, "Default", "Preferences"), withIt);
  ran.length = 0;
  assert.equal(await openOwnersChrome({ browsers: [chrome, brave], platform: "darwin", run }), "opened");
  assert.deepEqual(ran, [["open", "-b", "com.google.Chrome"]], "Chrome first when both have it");
});

test("with the extension nowhere nothing starts; a browser that fails to start gives way to the next", async () => {
  await using root = tempDir("apx-chrome-launch-");
  const withIt = `{"${CHROME_EXTENSION_ID}":{}}`;
  const ran: string[] = [];
  const run = async (cmd: string) => {
    ran.push(cmd);
    if (cmd === "google-chrome") throw new Error("not on PATH");
  };
  const chrome = browser(root.path, ".config/google-chrome", { profile: "Default", file: "Preferences", text: "{}" });
  assert.equal(await openOwnersChrome({ browsers: [chrome], platform: "linux", run }), "no_extension");
  assert.deepEqual(ran, []);

  fs.writeFileSync(path.join(chrome, "Default", "Preferences"), withIt);
  const chromium = browser(root.path, ".config/chromium", { profile: "Default", file: "Preferences", text: withIt });
  assert.equal(await openOwnersChrome({ browsers: [chrome, chromium], platform: "linux", run }), "opened");
  assert.deepEqual(ran, ["google-chrome", "chromium"]);

  ran.length = 0;
  assert.equal(await openOwnersChrome({ browsers: [chrome], platform: "linux", run }), "failed");
  assert.equal(await openOwnersChrome({ browsers: [chrome], platform: "win32", run }), "failed");
});
