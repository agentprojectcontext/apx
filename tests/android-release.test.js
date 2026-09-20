// What the phone is told about its own version.
//
// The comparison lives on this side and not in the app on purpose: it decides
// whether a person is shown an "update" button, the rules are semver's, and a
// second implementation in Java is a second set of opinions about 0.10.0.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Owns its sandbox BEFORE #core loads (AGENTS.md rule 1) — publishedApk writes
// its cache under APX_HOME, and a test must never touch the real one.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-android-home-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;

const { APK_URL, ANDROID_TAG, isNewerVersion } = await import("#core/android-release.js");

test("the download link is the pointer tag, which is what never moves", () => {
  assert.equal(ANDROID_TAG, "android-latest");
  // Printed in the docs, drawn as a QR in the panel and baked into
  // `apx android install`. If this string changes, those break silently.
  assert.equal(
    APK_URL,
    "https://github.com/agentprojectcontext/apx/releases/download/android-latest/apx.apk",
  );
});

test("a newer version is offered, an equal or older one is not", () => {
  assert.equal(isNewerVersion("0.2.9", "0.3.0"), true);
  assert.equal(isNewerVersion("0.3.0", "0.3.1"), true);
  assert.equal(isNewerVersion("0.3.0", "1.0.0"), true);
  assert.equal(isNewerVersion("0.3.0", "0.3.0"), false);
  assert.equal(isNewerVersion("0.3.1", "0.3.0"), false);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), false);
});

// The reason this is not a string comparison, and the reason it is not the
// versionCode either.
test("10 is bigger than 9, in every position", () => {
  assert.equal(isNewerVersion("0.9.0", "0.10.0"), true);
  assert.equal(isNewerVersion("0.10.0", "0.9.0"), false);
  assert.equal(isNewerVersion("0.3.9", "0.3.10"), true);
  assert.equal(isNewerVersion("9.0.0", "10.0.0"), true);
});

test("a leading v is the same version", () => {
  assert.equal(isNewerVersion("0.3.0", "v0.3.0"), false);
  assert.equal(isNewerVersion("v0.2.0", "0.3.0"), true);
});

// Whatever is missing or malformed, the answer must be "no update". Offering
// one that does not exist sends a phone to download the build it already has;
// worse, a garbage `latest` would offer it forever.
test("nothing is offered when either side is not a version", () => {
  assert.equal(isNewerVersion("0.3.0", ""), false);
  assert.equal(isNewerVersion("0.3.0", null), false);
  assert.equal(isNewerVersion("0.3.0", undefined), false);
  assert.equal(isNewerVersion("0.3.0", "no-soy-una-version"), false);
  assert.equal(isNewerVersion("", "0.3.0"), true, "an unknown install is behind everything");
});

// Short forms show up in the wild (a hand-typed gradle.properties, an older
// release). They must read as the zeros they mean, not as a failure.
test("a short version reads as the zeros it means", () => {
  assert.equal(isNewerVersion("0.3", "0.3.1"), true);
  assert.equal(isNewerVersion("1", "1.0.0"), false);
});
