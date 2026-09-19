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

test("the feature can be seen working, and says when it is being simulated", () => {
  // Everywhere this can be developed, `from_git` is true and the banner is
  // deliberately silent — so without a seam the only way to verify it would be
  // to ship it and wait for a stranger's bug report.
  const before = process.env.APX_UPDATE_SIMULATE;
  try {
    process.env.APX_UPDATE_SIMULATE = "9.9.9";
    const out = updateStatus("1.0.0");
    assert.equal(out.latest, "9.9.9");
    assert.equal(out.newer, true);
    // The two things the real verdict would suppress, both lifted.
    assert.equal(out.from_git, false);
    // …and marked, so nothing downstream can mistake it for the truth.
    assert.equal(out.simulated, true);
  } finally {
    if (before === undefined) delete process.env.APX_UPDATE_SIMULATE;
    else process.env.APX_UPDATE_SIMULATE = before;
  }
  // Absent by default: the seam must never be what a normal run takes.
  assert.equal(updateStatus("1.0.0").simulated, undefined);
});

test("the panel stays quiet in a checkout, and forgets one version at a time", () => {
  const banner = read("src/interfaces/web/src/components/common/UpdateBanner.tsx");
  assert.match(banner, /if \(!data\?\.newer \|\| !data\.latest \|\| data\.from_git\) return null;/);
  // Dismissal stores the VERSION. A boolean would silence every future release
  // the moment someone decided to skip one.
  assert.match(banner, /setItem\(STORAGE\.updateDismissed, data\.latest!\)/);
  assert.match(banner, /if \(dismissed === data\.latest\) return null;/);
  // Mounted by the corner queue now, not by the shell — one card at a time.
  assert.match(read("src/interfaces/web/src/components/common/CornerCards.tsx"), /<UpdateBanner \/>/);
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

test("the badge and the offer are driven by one answer, and lead somewhere", () => {
  const hook = read("src/interfaces/web/src/hooks/useUpdateStatus.ts");
  const rail = read("src/interfaces/web/src/components/layout/ProjectSidebar.tsx");
  const offer = read("src/interfaces/web/src/components/settings/UpdateOffer.tsx");
  const settings = read("src/interfaces/web/src/screens/SettingsScreen.tsx");

  // ONE SWR key for every surface that asks. Three callers each fetching would
  // be three requests and, worse, three verdicts: a badge on the gear over a
  // settings screen offering nothing is a light with nothing behind it.
  assert.match(hook, /useSWR\("update"/);
  // The checkout rule lives in the hook, so no caller has to remember it.
  assert.match(hook, /!data\.from_git/);
  for (const src of [rail, offer]) assert.match(src, /useUpdateStatus\(\)/);

  // Gear badge, and the offer at the foot of the settings nav.
  assert.match(rail, /update=\{updateAvailable\}/);
  assert.match(settings, /navFooter=\{<UpdateOffer \/>\}/);
  assert.match(offer, /if \(!newer\) return null;/);

  // The button hands the command to the Code terminal. It does NOT press Enter:
  // `apx update` stops the daemon that serves this terminal, so a real update
  // kills the connection showing it. A prepared command is honest about who
  // runs it; auto-running would look like a failure every time it worked.
  assert.match(offer, /navigate\(`\/code\?cmd=\$\{encodeURIComponent\(UPDATE_CMD\)\}`\)/);
  assert.match(hook, /export const UPDATE_CMD = "apx update"/);
  // …and the deep link must accept a command with no project, because a global
  // command has none to name.
  const code = read("src/interfaces/web/src/screens/modules/CodeScreen.tsx");
  assert.match(code, /if \(!cmd && !edit\) return;/);
  assert.match(code, /if \(wantPid && String\(pid\) !== String\(wantPid\)\)/);
});

test("the terminal notice can be seen, and the face survives a pipe", () => {
  const check = read("src/core/update-check.js");
  // The seam has to cover the CLI too. This notice fires off the cache, so
  // without it the only way to see the banner is to actually be a version
  // behind — the one state you cannot arrange on demand.
  assert.match(check, /const fake = process\.env\.APX_UPDATE_SIMULATE;/);
  assert.match(check, /if \(isNewer\(currentVersion, fake\)\) notice\(currentVersion, fake\);/);
  // A simulation must not write the cache, or it outlives itself.
  assert.match(check, /return; \/\/ no background refresh/);

  // Colour off when stdout is not a terminal. The panel's terminal prints what
  // /api/run returns as plain text, so escapes arrived as `[32m` rubble around
  // the face.
  assert.match(read("src/interfaces/cli/branding.js"),
    /const NO_COLOR = !!process\.env\.NO_COLOR \|\| !process\.stdout\.isTTY;/);
});
