// "There is a newer APX than the one running" — on both surfaces, from one cache.
//
// The CLI has said this after every command for a long time. The panel could
// not, so anyone who lives in the browser never found out. The risk in adding
// it is the opposite one: telling a developer running from a clone to `apx
// update`, which replaces a global npm install and has no business touching a
// checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateStatus } from "#core/update-check.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("one cache answers both surfaces", () => {
  // Not two pollers with two opinions: the daemon route returns exactly what
  // the CLI banner reads, so they can never disagree and npm is asked once a
  // day however many panels are open.
  const route = read("src/host/daemon/api/update.js");
  assert.match(route, /import \{ updateStatus \} from "#core\/update-check\.js"/);
  assert.match(route, /api\.get\("\/update"/);
});

test("the verdict knows it is running from a clone", () => {
  const out = updateStatus("0.0.1");
  assert.equal(typeof out.from_git, "boolean");
  // This repo IS a checkout, so the flag has to be true here — the assertion
  // fails loudly if the detection ever stops working.
  assert.equal(out.from_git, true);
  assert.equal(out.current, "0.0.1");
});

test("the panel stays quiet in a checkout, and forgets one version at a time", () => {
  const banner = read("src/interfaces/web/src/components/common/UpdateBanner.tsx");
  assert.match(banner, /if \(!data\?\.newer \|\| !data\.latest \|\| data\.from_git\) return null;/);
  // Dismissal stores the VERSION. A boolean would silence every future release
  // the moment someone decided to skip one.
  assert.match(banner, /setItem\(STORAGE\.updateDismissed, data\.latest!\)/);
  assert.match(banner, /if \(dismissed === data\.latest\) return null;/);
  assert.match(read("src/interfaces/web/src/App.tsx"), /<UpdateBanner \/>/);
});

test("a device says what it is running, and an older one says nothing", () => {
  // The phone cannot be asked after the fact, so this had to land before the
  // first public APK or every early install would be permanently silent.
  assert.match(read("src/interfaces/android/app/src/main/java/dev/agentprojectcontext/apx/DaemonClient.java"),
    /payload\.put\("app_version", BuildConfig\.VERSION_NAME\)/);
  // AGP 8 does not generate BuildConfig unless asked, and the app would not
  // compile without this.
  assert.match(read("src/interfaces/android/app/build.gradle"), /buildConfig true/);
  assert.match(read("src/host/daemon/api/pairing.js"), /addClient\(label \|\| "device", kind \|\| "device", app_version \|\| ""\)/);
  // Null, not a guess, for everything paired before this existed.
  assert.match(read("src/host/daemon/token-store.js"), /app_version: c\.app_version \|\| null/);
});
