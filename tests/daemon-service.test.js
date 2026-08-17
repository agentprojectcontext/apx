// The daemon as a supervised service (02-SPEC-capabilities.md § C7).
//
// NOTHING HERE INSTALLS ANYTHING. Every test asserts against generated unit
// text or takes the unsupported-platform branch, because installing a launch
// agent means writing into the developer's real ~/Library/LaunchAgents and
// loading it — mutating live state to prove a test passes is exactly what a
// test must not do.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-service-"));
process.env.HOME = TMP_HOME;

const {
  buildDaemonPlist, buildSystemdUnit, getDaemonRunner,
  serviceStatus, installService, uninstallService,
  SERVICE_LABEL,
} = await import("#core/daemon/service.js");

// --------------------------------------------------------------------------
// the two mistakes that would make this useless
// --------------------------------------------------------------------------

test("the supervisor runs the daemon entry, not the CLI wrapper", () => {
  // `apx daemon start` spawns the daemon DETACHED and exits. Under KeepAlive
  // the supervisor would see its child die within a second, restart it, and
  // loop forever — spawning a new daemon each time. A supervised process must
  // be the daemon itself.
  const [bin, entry] = getDaemonRunner();
  assert.equal(bin, process.execPath, "an absolute node path, never a shell shim");
  assert.match(entry, /host[/\\]daemon[/\\]index\.js$/);
  assert.doesNotMatch(buildDaemonPlist(), /<string>daemon<\/string>/);
  assert.doesNotMatch(buildSystemdUnit(), /daemon start/);
});

test("the plist keeps the daemon alive — unlike the desktop's", () => {
  const plist = buildDaemonPlist();
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  // A dying process with no throttle restarts in a tight loop and fills the disk.
  assert.match(plist, /<key>ThrottleInterval<\/key><integer>\d+<\/integer>/);
});

test("both units carry an augmented PATH", () => {
  // launchd's PATH is /usr/bin:/bin:/usr/sbin:/sbin. Everything the daemon
  // spawns below itself — ffmpeg for whisper, npx for stdio MCPs — resolves
  // through it. This exact omission killed voice once already.
  assert.match(buildDaemonPlist(), /<key>PATH<\/key><string>[^<]+<\/string>/);
  assert.match(buildSystemdUnit(), /^Environment=PATH=.+/m);
});

test("systemd restarts always, and gives up only on a crash loop", () => {
  const unit = buildSystemdUnit();
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^RestartSec=\d+$/m);
  assert.match(unit, /^StartLimitBurst=\d+$/m);
  // A per-user service, so the user's session — not the machine's boot.
  assert.match(unit, /^WantedBy=default\.target$/m);
});

test("the plist is well-formed XML with the expected label", () => {
  const plist = buildDaemonPlist();
  assert.match(plist, /^<\?xml version="1\.0"/);
  assert.match(plist, new RegExp(`<key>Label</key><string>${SERVICE_LABEL}</string>`));
  assert.ok(plist.trimEnd().endsWith("</plist>"));
});

test("paths with spaces survive both formats", () => {
  const runner = ["/usr/local/my node/bin/node", "/Users/a b/apx/daemon.js"];
  assert.match(buildDaemonPlist(runner), /<string>\/usr\/local\/my node\/bin\/node<\/string>/);
  assert.match(buildSystemdUnit(runner), /ExecStart="\/usr\/local\/my node\/bin\/node" "\/Users\/a b\/apx\/daemon\.js"/);
});

test("XML metacharacters in a path cannot break the plist", () => {
  const plist = buildDaemonPlist([process.execPath, "/tmp/a&b<c>/daemon.js"]);
  assert.match(plist, /a&amp;b&lt;c&gt;/);
  assert.doesNotMatch(plist, /a&b<c>/);
});

// --------------------------------------------------------------------------
// honesty about Windows
// --------------------------------------------------------------------------

test("Windows is reported as NOT supervised, in so many words", () => {
  // A Run key starts the daemon at login and does not restart it if it dies,
  // which is most of what a service is for. Claiming otherwise is a lie the
  // user only discovers the morning nothing ran.
  const s = serviceStatus("win32");
  assert.equal(s.supervised, false);
  assert.match(s.note, /does NOT restart/i);
});

test("macOS and Linux are reported as supervised", () => {
  assert.equal(serviceStatus("darwin").supervised, true);
  assert.equal(serviceStatus("linux").supervised, true);
});

// --------------------------------------------------------------------------
// an unsupported platform fails cleanly rather than throwing
// --------------------------------------------------------------------------

test("an unknown platform refuses with a message, on every entry point", () => {
  const status = serviceStatus("sunos");
  assert.equal(status.installed, false);
  assert.equal(status.supervised, false);

  const install = installService("sunos");
  assert.equal(install.ok, false);
  assert.match(install.error, /not supported/);

  const remove = uninstallService("sunos");
  assert.equal(remove.ok, false);
  assert.match(remove.error, /not supported/);
});

test("status on a clean home reports nothing installed", () => {
  // TMP_HOME has no LaunchAgents directory, so this is the honest answer
  // without touching the developer's real one.
  assert.equal(serviceStatus("darwin").installed, false);
  assert.equal(serviceStatus("linux").installed, false);
});
