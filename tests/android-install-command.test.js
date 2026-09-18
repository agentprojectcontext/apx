// `apx android install` — the decisions that are invisible when they go wrong.
//
// Everything here is a contract no test can exercise without a phone on a
// cable, so it is pinned at the source. Each one has already failed once: the
// deep link lost its pairing id to the phone's shell, the address it paired
// with was the one guaranteed to stop working, and the APK it installed was a
// stale build signed with a key the real release cannot replace.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "src/interfaces/cli/commands/android.js"), "utf8");

test("the pairing deep link survives the phone's own shell", () => {
  // `adb shell` hands its arguments to a shell ON THE DEVICE, which reads the
  // `&` between url and pid as "background the rest". The phone then opened the
  // pairing screen with an address and no code and waited forever.
  const call = /am", "start".*?\], \{ device \}\)/s.exec(src)?.[0] || "";
  assert.ok(call.includes("`'${link}'`"), "the deep link must be quoted for the device shell");
});

test("it pairs with an address the phone can keep, not with the cable", () => {
  // The app stores whatever address it paired with. `adb reverse` is a tunnel,
  // so 127.0.0.1 is true only while plugged in.
  assert.match(src, /async function chooseDaemonUrl/);
  // Two questions, because either alone is wrong: the endpoint list names LAN
  // interfaces a loopback-bound daemon does not serve, and the best address in
  // it is useless if THIS phone is not on that tailnet.
  assert.match(src, /async function serves\(url\)/);
  assert.match(src, /async function phoneCanReach\(bin, device, url\)/);
  assert.match(src, /ping", "-c", "1"/);
  // Loopback is never *chosen* — it is what is left when nothing else answers.
  assert.match(src, /continue; \/\/ the cable, handled separately/);
  assert.match(src, /loopback: true/);
});

test("the published APK is the default, and a local build is never silent", () => {
  // A checkout build is signed with the debug key; a released one is not. Once
  // a phone holds one, the other cannot update over it without an uninstall
  // that deletes the pairing — so which one gets installed is a decision, not
  // a convenience.
  assert.match(src, /if \(args\.flags\?\.local\)/);
  assert.doesNotMatch(src, /flags\?\.latest/, "--latest is gone: the release is the default now");
  // The fallback exists (no release yet, no network) and announces itself.
  assert.match(src, /falling back to the build in this checkout/);
  assert.match(src, /signed with the DEBUG key/);
});

test("the pairing code is printed whether or not the phone takes it", () => {
  // The auto-submit is the happy path, not the only one. When it does not land,
  // this loop is the only thing that knows the code.
  assert.match(src, /if it asks, type it by hand/);
});

test("installing asks first, and refuses to guess when nobody can answer", () => {
  assert.match(src, /if \(!args\.flags\?\.yes\)/);
  assert.match(src, /if \(!process\.stdin\.isTTY\)/);
  assert.match(src, /refusing to run unattended/);
});
