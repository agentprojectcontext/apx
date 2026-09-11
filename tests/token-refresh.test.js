// A daemon restart must not leave the panel deaf.
//
// The daemon mints a NEW master token on every boot (host/daemon/index.js calls
// generateToken() unconditionally in main()). That is deliberate — restarting
// revokes a token that leaked into a tunnel link, a screenshot or a log — and
// the panel had no way back from it. The token was acquired once at first paint
// and never again, so after an `apx restart` under an open tab:
//
//   · every HTTP request answered 401 — SWR kept showing its last data, so the
//     screen looked fine
//   · the events socket reconnected forever against a token the daemon had
//     already forgotten, which killed every live feature at once: no streaming,
//     no "pensando…", no tool appearing, no thread catching up, no spinner
//   · nothing said so, and the only cure was a reload nobody knew to do
//
// On a machine where the daemon is restarted all afternoon, that is most of the
// afternoon. Measured, not reasoned about: the browser held 23db49ec… while the
// daemon had moved to 996344ca…, and the socket had been retrying for minutes.
//
// TWO THINGS THIS TEST GUARDS, and the second is the one the first attempt at
// this fix got wrong — it made things worse before it made them better:
//   1. a 401 triggers exactly one refresh-and-retry, never a loop
//   2. a refresh that FAILS still leaves the reconnect loop alive, and does not
//      report "this browser needs pairing" for a daemon that is merely rebooting
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = (...p) => fs.readFileSync(path.join(ROOT, "src/interfaces/web/src", ...p), "utf8");

test("the daemon really does rotate its token on every boot", () => {
  // The premise. If this ever stops being true the recovery below is harmless,
  // but the comments explaining WHY it exists would become fiction.
  const daemon = fs.readFileSync(path.join(ROOT, "src/host/daemon/index.js"), "utf8");
  const main = daemon.slice(daemon.indexOf("async function main()"));
  assert.match(main.slice(0, 400), /const token = generateToken\(\);/);
  assert.match(daemon, /function generateToken\(\)[\s\S]{0,200}randomBytes\(32\)/);
});

test("a 401 refreshes the token and retries once", () => {
  const http = web("lib", "http.ts");
  assert.match(http, /res\.status === 401 \|\| res\.status === 403/);
  assert.match(http, /const fresh = await refreshToken\(\)/);
  // Once. A second 401 on a token we just obtained is a real refusal, and
  // retrying it forever is how a login loop is built.
  assert.match(http, /if \(fresh && fresh !== headers\.authorization\?\.slice\(7\)\)/);
  // One refresh in flight at a time, however many requests hit 401 together.
  assert.match(http, /if \(!reauthorizing\) \{[\s\S]{0,200}reauthorizing = reauthorize\(\)/);
});

test("the socket asks for a token before retrying a refused handshake", () => {
  const live = web("lib", "live.ts");
  // A browser cannot read the handshake's status, so "never opened" is the
  // signal that the token is the suspect rather than the network.
  assert.match(live, /if \(!opened\) rejected = true;/);
  assert.match(live, /if \(rejected\) \{[\s\S]{0,400}refreshToken\(\)/);
});

test("a failed refresh does not stop the socket trying", () => {
  // The regression the first version of this fix introduced: `connect()`
  // returned on the refresh branch, so ONE attempt while the daemon was still
  // coming back up left the socket never trying again. A panel that used to
  // reconnect forever against a dead token simply stopped instead.
  const live = web("lib", "live.ts");
  const branch = live.slice(live.indexOf("if (rejected) {"), live.indexOf("let opened = false"));
  assert.match(branch, /\.catch\(\(\) => null\)/, "a refresh that throws is not an exit");
  assert.match(branch, /\.then\(\(\) => \{ attempts = 0; scheduleReconnect\(\); \}\)/,
    "whatever the refresh answers, the loop goes on");
});

test("a rebooting daemon is not reported as an unpaired browser", () => {
  // "Nothing answered" lasts for the second or two of every restart. Reporting
  // it as "this browser needs to be paired" throws the reader onto a pairing
  // screen, with a code to type, because a daemon was rebooting — which is
  // exactly what happened the first time this was tried.
  const boot = web("hooks", "useTokenBootstrap.ts");
  assert.match(boot, /\| \{ unreachable: true \}/, "the two failures are different things");
  assert.match(boot, /\| \{ refused: true \}/);
  assert.match(boot, /if \("refused" in got\) setState\(\{ status: "unpaired" \}\)/);
  // …and nothing sets a status for the unreachable case.
  const reauth = boot.slice(boot.indexOf("setReauthorize(async"), boot.indexOf("return () => setReauthorize(null)"));
  assert.doesNotMatch(reauth, /unreachable" in got\) setState/);
});

test("one implementation of 'get me a token', used at first paint and after a 401", () => {
  const boot = web("hooks", "useTokenBootstrap.ts");
  // Call sites, not the declaration (which this pattern would also catch).
  assert.equal(
    (boot.match(/await fetchLoopbackToken\(\)/g) || []).length,
    2,
    "the bootstrap and the recovery must not drift into two ways of storing a token",
  );
  // And only one place writes the token down.
  assert.equal((boot.match(/localStorage\.setItem\(STORAGE\.token/g) || []).length, 3,
    "pairing, the tunnel fragment and the loopback fetch — no fourth spelling");
});
