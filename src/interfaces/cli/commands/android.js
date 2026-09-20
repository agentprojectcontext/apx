// `apx android` — put the Android app on a phone that is plugged in, and pair
// it, without anyone typing a URL on a 6-inch keyboard.
//
// APX is not on Play, so the app arrives as a file. The awkward part was never
// the download: it is that a freshly installed app then asks for the daemon's
// address and a pairing code, and the one address that always works over a
// cable — 127.0.0.1 — means nothing to the phone until `adb reverse` exists.
// So this command does the four steps in the order that makes them true:
//
//   install  →  adb reverse  →  ask the daemon for a pairing  →  deep link it
//
// The last step is why the app has an `apx://pair?url=…&pid=…` intent with
// auto-submit (MainActivity.handleIntent): the phone receives the address and
// the code from the cable, and the owner only watches.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { readConfig, effectivePort } from "#core/config/index.js";
import { apxHome } from "#core/config/paths.js";
import { APK_URL as PUBLISHED_APK_URL, publishedApk } from "#core/android-release.js";
import { http } from "../http.js";

const run = promisify(execFile);

/** Where the published APK lives. A pointer tag, so this link never moves. */
export const APK_URL = PUBLISHED_APK_URL;

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", gray: "\x1b[90m", yellow: "\x1b[33m",
};
const fmt = {
  bold: (s) => `${c.bold}${s}${c.reset}`,
  dim: (s) => `${c.dim}${s}${c.reset}`,
  green: (s) => `${c.green}${s}${c.reset}`,
  red: (s) => `${c.red}${s}${c.reset}`,
  cyan: (s) => `${c.cyan}${s}${c.reset}`,
  gray: (s) => `${c.gray}${s}${c.reset}`,
  yellow: (s) => `${c.yellow}${s}${c.reset}`,
};

const PACKAGE = "dev.agentprojectcontext.apx";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── adb ──────────────────────────────────────────────────────────────────────

/**
 * Find adb. It is on PATH for anyone who installed platform-tools with a
 * package manager, and inside the SDK for anyone who got it from Android
 * Studio — which does not put it on PATH.
 */
function findAdb() {
  const candidates = [
    process.env.APX_ADB,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, "platform-tools", "adb"),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb"),
    path.join(os.homedir(), "Library", "Android", "sdk", "platform-tools", "adb"),
    path.join(os.homedir(), "Android", "Sdk", "platform-tools", "adb"),
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* unreadable path */ }
  }
  try {
    return execFileSync(process.platform === "win32" ? "where" : "which", ["adb"], {
      encoding: "utf8",
    }).split("\n")[0].trim() || null;
  } catch {
    return null;
  }
}

async function adb(bin, args, { device } = {}) {
  const full = device ? ["-s", device, ...args] : args;
  const { stdout, stderr } = await run(bin, full, { maxBuffer: 16 * 1024 * 1024 });
  return `${stdout}${stderr}`;
}

/**
 * The attached phone, or a clear reason why there is none.
 *
 * `adb devices` answers three different situations with three different words,
 * and each one has a different thing for the owner to do — which is why this
 * does not collapse them into "no device found".
 */
async function pickDevice(bin, wanted) {
  const out = await adb(bin, ["devices", "-l"]);
  const rows = out
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("*"))
    .map((l) => {
      const [serial, state] = l.split(/\s+/);
      return { serial, state, line: l };
    });

  if (wanted) {
    const hit = rows.find((r) => r.serial === wanted);
    if (!hit) throw new Error(`no device with serial "${wanted}" is attached.`);
    if (hit.state !== "device") throw new Error(stateHelp(hit));
    return hit.serial;
  }

  const ready = rows.filter((r) => r.state === "device");
  if (ready.length === 1) return ready[0].serial;
  if (ready.length > 1) {
    const list = ready.map((r) => `    ${r.serial}`).join("\n");
    throw new Error(`more than one device is attached — choose with --device <serial>:\n${list}`);
  }
  if (rows.length) throw new Error(stateHelp(rows[0]));
  throw new Error(
    "no phone is attached.\n" +
    "  Plug it in over USB and turn on USB debugging:\n" +
    "    Settings → About phone → tap Build number 7 times\n" +
    "    Settings → System → Developer options → USB debugging",
  );
}

function stateHelp(row) {
  if (row.state === "unauthorized") {
    return `the phone (${row.serial}) has not accepted this computer.\n` +
           "  Unlock it and accept the \"Allow USB debugging?\" prompt, then run this again.";
  }
  if (row.state === "offline") {
    return `the phone (${row.serial}) is offline — unplug and plug it back in.`;
  }
  return `the phone (${row.serial}) is in state "${row.state}", not ready to install.`;
}

// ── the APK ──────────────────────────────────────────────────────────────────

/** A release build in this checkout, if someone just built one. */
function localBuild() {
  // fileURLToPath, not url.pathname: the latter keeps %20 for a checkout under
  // a path with a space, and starts with a slash on Windows.
  const here = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..", "..", "android", "app", "build", "outputs", "apk",
  );
  for (const variant of ["release/app-release.apk", "debug/app-debug.apk"]) {
    const p = path.join(here, variant);
    try { if (fs.existsSync(p)) return p; } catch { /* not a dev checkout */ }
  }
  return null;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `could not download the APK (HTTP ${res.status}).\n` +
      `  Tried: ${url}\n` +
      "  Download it by hand from the releases page and pass it with --apk <file>.",
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/**
 * WHICH apk, decided without touching the network — so the confirmation below
 * can say what is about to happen before anything happens.
 */
function planApk(args) {
  const given = args.flags?.apk;
  if (typeof given === "string") {
    const p = path.resolve(given);
    if (!fs.existsSync(p)) throw new Error(`no such file: ${p}`);
    return { file: p, from: "flag" };
  }

  // The PUBLISHED build is the default, even inside a checkout that has one of
  // its own. "Install APX on my phone" means the app everyone else is running;
  // a local build is a different thing that happens to live at the same path,
  // it is usually older than it looks, and — the part that bites — it is signed
  // with the debug key, so the first real release cannot update over it.
  if (args.flags?.local) {
    const built = localBuild();
    if (!built) throw new Error("--local: no build in this checkout. Run `./gradlew assembleDebug` in src/interfaces/android first.");
    return { file: built, from: "build" };
  }

  return { file: null, from: "release" };
}

async function materializeApk(plan) {
  if (plan.file) return plan.file;
  const dest = path.join(apxHome(), "cache", "apx-android-latest.apk");
  console.log(`  ${fmt.gray("downloading")} ${fmt.dim(APK_URL)}`);
  try {
    const bytes = await download(APK_URL, dest);
    console.log(`  ${fmt.gray("saved")} ${fmt.dim(`${(bytes / 1048576).toFixed(1)} MB → ${dest}`)}`);
    return dest;
  } catch (e) {
    // Before the first release exists — and on a plane — there may still be a
    // build right here. Using it is better than refusing, but it is a DIFFERENT
    // artifact signed with a different key, so it is offered out loud and never
    // quietly substituted.
    const built = localBuild();
    if (!built) throw e;
    console.log("");
    console.log(`  ${fmt.yellow("○")} ${e.message.split("\n")[0]}`);
    console.log(`  ${fmt.yellow("○")} falling back to the build in this checkout:`);
    console.log(`    ${fmt.dim(built)}`);
    console.log(`    ${fmt.gray("It is signed with the DEBUG key. A published release cannot update over")}`);
    console.log(`    ${fmt.gray("it later — that needs an uninstall, which deletes this phone's pairing.")}`);
    console.log("");
    return built;
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── install ──────────────────────────────────────────────────────────────────

export async function cmdAndroidInstall(args = {}) {
  const bin = findAdb();
  if (!bin) {
    console.error(fmt.red("apx android install: adb is not installed."));
    console.error("");
    console.error("  adb is Android's own USB tool. Install the platform tools:");
    console.error(`    macOS    ${fmt.cyan("brew install --cask android-platform-tools")}`);
    console.error(`    Linux    ${fmt.cyan("sudo apt install android-tools-adb")}`);
    console.error(`    Windows  ${fmt.cyan("winget install Google.PlatformTools")}`);
    console.error("");
    console.error("  Or install from the phone instead — no cable needed:");
    console.error(`    ${fmt.cyan(APK_URL)}`);
    process.exit(1);
  }

  let device;
  try {
    device = await pickDevice(bin, typeof args.flags?.device === "string" ? args.flags.device : null);
  } catch (e) {
    console.error(fmt.red(`apx android install: ${e.message}`));
    process.exit(1);
  }

  const port = effectivePort(readConfig());
  const plan = planApk(args);
  const willPair = !args.flags?.["no-pair"];
  const willReverse = !args.flags?.["no-reverse"];

  console.log("");
  console.log(`  ${fmt.bold("APX Android")}  ${fmt.gray("·")}  ${fmt.dim(device)}`);
  console.log("");
  console.log(`  ${fmt.gray("This will:")}`);
  console.log(`    · install ${plan.from === "build"
    ? `${fmt.bold("the build in this checkout")} ${fmt.dim(plan.file)}`
    : plan.from === "flag"
      ? fmt.bold(plan.file)
      : `${fmt.bold("the published release")} ${fmt.dim("(downloads it first)")}`} on that phone`);
  if (willReverse) console.log(`    · open a USB tunnel so ${fmt.bold(`127.0.0.1:${port}`)} on the phone reaches this daemon`);
  if (willPair) console.log(`    · pair it — a new device token, revocable with ${fmt.cyan("apx pair revoke")}`);
  console.log("");

  // Installing software on someone's phone and handing it a credential is not
  // something to start from a bare command line. --yes is for scripts, and a
  // pipe with no --yes is refused rather than assumed.
  if (!args.flags?.yes) {
    if (!process.stdin.isTTY) {
      console.error(fmt.red("  refusing to run unattended — pass --yes if this is a script."));
      process.exit(1);
    }
    const answer = await ask(`  Continue? ${fmt.dim("[Y/n]")} `);
    if (answer && !["y", "yes", "s", "si", "sí"].includes(answer)) {
      console.log(`  ${fmt.gray("nothing done")}`);
      return;
    }
    console.log("");
  }

  const apkFile = await materializeApk(plan);
  if (plan.from === "build") {
    console.log(`  ${fmt.dim("(--latest downloads the published one instead)")}`);
  }

  // -r keeps the app's data, which is the pairing token: reinstalling must not
  // silently unpair a phone that was already set up.
  console.log(`  ${fmt.gray("installing…")}`);
  try {
    await adb(bin, ["install", "-r", apkFile], { device });
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}${e.message || ""}`;
    if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(out)) {
      console.error("");
      console.error(fmt.red("  A different APX is already installed, signed with another key."));
      console.error("  Android will not replace it — the signature is the identity.");
      console.error(`  Uninstall it first (this deletes its pairing): ${fmt.cyan(`adb uninstall ${PACKAGE}`)}`);
      process.exit(1);
    }
    if (/INSTALL_PARSE_FAILED_NO_CERTIFICATES|not signed/i.test(out)) {
      console.error("");
      console.error(fmt.red("  That APK is unsigned, so Android refuses to install it."));
      console.error("  A release build needs a keystore — see docs/…/surfaces/android.");
      process.exit(1);
    }
    console.error(fmt.red(`  install failed: ${out.trim().split("\n").slice(-3).join("\n  ")}`));
    process.exit(1);
  }
  console.log(`  ${fmt.green("●")} installed`);

  // The whole reason the cable works. Without it the phone resolves
  // 127.0.0.1 to ITSELF and the daemon is simply not there.
  if (args.flags?.["no-reverse"]) {
    console.log(`  ${fmt.dim("skipped adb reverse (--no-reverse)")}`);
  } else {
    await adb(bin, ["reverse", `tcp:${port}`, `tcp:${port}`], { device });
    console.log(`  ${fmt.green("●")} ${fmt.gray(`127.0.0.1:${port} on the phone now reaches this daemon`)}`);
    console.log(`    ${fmt.dim("this lasts until the cable is unplugged — for a lasting address see `apx panel tailscale on`")}`);
  }

  if (args.flags?.["no-pair"]) {
    console.log("");
    console.log(`  ${fmt.gray("open APX on the phone and pair it by hand — `apx pair web` prints a code")}`);
    console.log("");
    return;
  }

  await pairOverCable(bin, device, port, args);
}

/**
 * Which daemon address to pair with — the one the app will keep.
 *
 * This used to be hard-coded to `127.0.0.1`, which is true only while the cable
 * is plugged in: `adb reverse` is a tunnel, not an address, and a phone paired
 * that way works tethered and nowhere else. The daemon already ranks its own
 * addresses best-first (tailnet HTTPS, tailnet, LAN, loopback), so the job here
 * is to pick the best one that is actually TRUE, and two different things have
 * to be true at once:
 *
 *   · the daemon answers there  — checked from here over HTTP. The list is not
 *     a promise: reachableEndpoints() names every LAN interface even when the
 *     daemon is bound to loopback and serves none of them.
 *   · the phone can reach there — checked from the phone with ping. A tailnet
 *     URL is the best address in the list and completely useless if that phone
 *     is not signed into the tailnet, which is a thing only the phone knows.
 *
 * Ping is a weaker question than HTTP (a route, not a service), but it is the
 * only one this phone can answer: Android ships neither curl nor wget. So a
 * failed ping demotes a candidate instead of disqualifying it — on a network
 * that drops ICMP the answer is "not confirmed", not "unreachable".
 */
async function chooseDaemonUrl(bin, device, candidates, port) {
  const probed = [];
  const unreachable = [];
  for (const url of candidates) {
    if (/\/\/(127\.0\.0\.1|localhost)\b/.test(url)) continue; // the cable, handled separately
    if (!(await serves(url))) continue;
    probed.push(url);
    if (await phoneCanReach(bin, device, url)) {
      return { url, confirmed: true, passedOver: unreachable };
    }
    // The daemon serves it and this phone cannot get there. Worth NAMING: it is
    // usually the best address in the list, and usually for a reason the owner
    // can undo in two taps.
    unreachable.push(url);
  }
  if (probed.length) return { url: probed[0], confirmed: false, passedOver: unreachable };
  return { url: `http://127.0.0.1:${port}`, confirmed: false, loopback: true, passedOver: unreachable };
}

/** Is Tailscale on that phone at all? Decides which advice is worth giving. */
async function phoneHasTailscale(bin, device) {
  try {
    const out = await adb(bin, ["shell", "pm", "list", "packages", "com.tailscale.ipn"], { device });
    return out.includes("com.tailscale.ipn");
  } catch {
    return false;
  }
}

/** Does the daemon actually answer there? */
async function serves(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Can the phone route to that host at all? */
async function phoneCanReach(bin, device, url) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  try {
    const out = await adb(bin, ["shell", "ping", "-c", "1", "-W", "2", host], { device });
    return /1 received|1 packets received/.test(out);
  } catch {
    return false;
  }
}

/**
 * Hand the phone its address and its code through the cable.
 *
 * The daemon's pairing endpoints are loopback-only by design, so the phone
 * cannot ask for a pairing itself — the CLI asks, and passes the answer over
 * adb as a deep link the app auto-submits.
 */
async function pairOverCable(bin, device, port, args = {}) {
  let init;
  try {
    init = await http.post("/api/pair/init", {});
  } catch (e) {
    console.error("");
    console.error(fmt.red(`  the daemon did not hand out a pairing: ${e.message}`));
    console.error(`  Start it and pair by hand: ${fmt.cyan("apx pair web")}`);
    process.exit(1);
  }

  // `--url` wins outright: whoever passes it knows something about their
  // network that no probe here can discover.
  const forced = typeof args.flags?.url === "string" ? args.flags.url : null;
  const picked = forced
    ? { url: forced.replace(/\/+$/, ""), confirmed: false, forced: true }
    : await chooseDaemonUrl(bin, device, init.lan_urls || [], port);
  const daemonUrl = picked.url;

  if (picked.loopback) {
    console.log(`  ${fmt.yellow("○")} ${fmt.bold("pairing over the cable")} ${fmt.dim(daemonUrl)}`);
    console.log(`    ${fmt.gray("No address this phone can keep was reachable, so it gets the USB tunnel —")}`);
    console.log(`    ${fmt.gray("which stops working the moment you unplug it.")}`);
    console.log(`    ${fmt.gray("For one that lasts:")} ${fmt.cyan("apx panel tailscale on")} ${fmt.gray("and pair again.")}`);
  } else if (picked.forced) {
    console.log(`  ${fmt.green("●")} pairing with ${fmt.bold(daemonUrl)} ${fmt.dim("(--url)")}`);
  } else if (picked.confirmed) {
    console.log(`  ${fmt.green("●")} pairing with ${fmt.bold(daemonUrl)} ${fmt.dim("— the phone reached it")}`);
  } else {
    console.log(`  ${fmt.green("●")} pairing with ${fmt.bold(daemonUrl)}`);
    console.log(`    ${fmt.dim("the daemon answers there, but this phone did not confirm it (ICMP blocked?)")}`);
  }

  // A better address existed and this phone could not get to it. Saying which
  // one, and why it is probably off, is the difference between "APX chose the
  // LAN" and "APX quietly gave you an address that stops at your front door".
  for (const url of picked.passedOver || []) {
    const tailnet = /\.ts\.net|\/\/100\./.test(url);
    console.log(`    ${fmt.yellow("○")} ${fmt.dim(`${url} would be better — this phone could not reach it`)}`);
    if (tailnet) {
      const installed = await phoneHasTailscale(bin, device);
      console.log(`      ${fmt.gray(installed
        ? "Tailscale is installed on that phone but not connected. Turn it on and run this again"
        : "install Tailscale on that phone and sign into this tailnet, then run this again")}`);
      console.log(`      ${fmt.gray("for an address that works away from home. Or force it:")} ${fmt.cyan(`--url ${url}`)}`);
    }
  }

  const link = `apx://pair?url=${encodeURIComponent(daemonUrl)}&pid=${init.pairing_id}`;

  // The quotes are not decoration. `adb shell` hands its arguments to the
  // PHONE's shell, which reads the `&` in the query string as "run the rest in
  // the background" — so the app got the url and never the pid, opened the
  // pairing screen, and sat there waiting for a code that was never sent.
  await adb(bin, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${link}'`], { device });

  console.log("");
  console.log(`  ${fmt.gray("pairing…")} ${fmt.dim("the app opens on the phone and confirms by itself")}`);
  // Printed every time, not only on failure: if the auto-submit does not land
  // there has to be something on screen to type, and by then this loop is the
  // only thing that knows the code.
  console.log(`    ${fmt.gray("if it asks, type it by hand —")} ${fmt.gray("url:")} ${fmt.cyan(daemonUrl)}  ${fmt.gray("code:")} ${fmt.bold(init.pairing_id)}`);

  const deadline = Date.now() + (init.ttl_ms || 90_000) + 5_000;
  while (Date.now() < deadline) {
    await sleep(1500);
    try {
      // autoStart:false — this polls every 1.5s for up to five minutes, and
      // every request otherwise re-checks the daemon with a 400ms ping. One
      // slow ping spawned a second daemon and printed "starting daemon…" into
      // the middle of the pairing.
      const s = await http.get(`/api/pair/status/${init.pairing_id}`, { autoStart: false });
      if (s.status === "confirmed") {
        console.log("");
        console.log(`  ${fmt.green("●")} ${fmt.bold("paired")} ${fmt.gray("·")} ${s.device_label || "APX Android"}`);
        console.log(`    ${fmt.dim(`revoke it any time with \`apx pair revoke ${String(s.client_id || "").slice(0, 8)}\``)}`);
        console.log("");
        console.log(`  ${fmt.gray("Notifications, the floating mascot and the car cards each need a")}`);
        console.log(`  ${fmt.gray("system permission the app asks for on its own — see `apx help android`.")}`);
        console.log("");
        return;
      }
      if (s.status === "expired" || s.status === "unknown") break;
    } catch {
      /* transient — the daemon may be busy; keep polling until the deadline */
    }
  }
  console.log("");
  console.log(`  ${fmt.yellow("○")} the phone did not confirm in time.`);
  console.log(`    Open APX on it and run ${fmt.cyan("apx android install --no-reverse")} again, or pair by hand with ${fmt.cyan("apx pair web")}.`);
  console.log("");
}

/**
 * The version of the published APK. Best-effort: no network, no answer, and
 * status says nothing rather than claiming the phone is current.
 *
 * Shared with the daemon (`GET /api/android/latest`, which is how the PHONE
 * asks the same question) so the cable and the app can never disagree about
 * what the newest build is.
 */
async function publishedVersion() {
  return (await publishedApk({ timeoutMs: 4000 }))?.version || null;
}

// ── status ───────────────────────────────────────────────────────────────────

export async function cmdAndroidStatus() {
  const bin = findAdb();
  console.log("");
  if (!bin) {
    console.log(`  ${fmt.red("○")} adb not installed — ${fmt.dim("no cable install from here")}`);
    console.log(`    ${fmt.gray("install from the phone instead:")} ${fmt.cyan(APK_URL)}`);
    console.log("");
    return;
  }
  console.log(`  ${fmt.green("●")} adb ${fmt.dim(bin)}`);

  let device;
  try {
    device = await pickDevice(bin, null);
  } catch (e) {
    console.log(`  ${fmt.gray("○")} ${e.message.split("\n")[0]}`);
    console.log("");
    return;
  }
  console.log(`  ${fmt.green("●")} phone ${fmt.dim(device)}`);

  const out = await adb(bin, ["shell", "dumpsys", "package", PACKAGE], { device });
  const version = /versionName=(\S+)/.exec(out)?.[1];
  const code = /versionCode=(\d+)/.exec(out)?.[1];
  if (version) {
    console.log(`  ${fmt.green("●")} APX installed ${fmt.dim(`${version} (code ${code})`)}`);
    // Over the cable this is the one place that sees both numbers at once
    // without the phone doing anything. The phone can now ask on its own too —
    // the daemon answers it from this same cache (api/android.js).
    const published = await publishedVersion();
    if (published && published !== version) {
      console.log(`  ${fmt.yellow("○")} the published APK is ${fmt.bold(published)} — ${fmt.cyan("apx android install")}`);
    }
  } else {
    console.log(`  ${fmt.gray("○")} APX is not installed — ${fmt.cyan("apx android install")}`);
  }

  const port = effectivePort(readConfig());
  const rev = await adb(bin, ["reverse", "--list"], { device });
  if (rev.includes(`tcp:${port}`)) {
    console.log(`  ${fmt.green("●")} reverse tunnel ${fmt.dim(`127.0.0.1:${port} → this daemon`)}`);
  } else {
    console.log(`  ${fmt.gray("○")} no reverse tunnel ${fmt.dim(`(adb reverse tcp:${port} tcp:${port})`)}`);
  }
  console.log("");
}
