import { spawnSync } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { getLatestVersion } from "#core/update-check.js";
import { apxBanner } from "../branding.js";
import { http } from "../http.js";

const PACKAGE_NAME = "@agentprojectcontext/apx";

function isNewer(cur, lat) {
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [ma, mi, pa] = parse(cur);
  const [mb, mib, pb] = parse(lat);
  if (mb > ma) return true;
  if (mb === ma && mib > mi) return true;
  if (mb === ma && mib === mi && pb > pa) return true;
  return false;
}

function hasPnpmGlobal() {
  const r = spawnSync("pnpm", ["--version"], { encoding: "utf8", stdio: "pipe" });
  if (r.status !== 0) return false;
  // `pnpm add -g` needs a configured global *bin* directory (PNPM_HOME / the
  // result of `pnpm setup`). `pnpm root -g` succeeds even without it, so probe
  // `pnpm bin -g` instead — it fails with ERR_PNPM_NO_GLOBAL_BIN_DIR when the
  // global bin directory is missing.
  const check = spawnSync("pnpm", ["bin", "-g"], { encoding: "utf8", stdio: "pipe" });
  return check.status === 0 && !!check.stdout?.trim();
}

// Detect which package manager actually owns this apx install, by checking
// where the running files live. Most installs are npm (it was the recommended
// installer before the project moved to pnpm), so npm is the safe default
// when detection is inconclusive.
function detectInstaller() {
  let selfDir;
  try {
    selfDir = fileURLToPath(import.meta.url);
  } catch {
    selfDir = "";
  }
  const probe = (cmd) => {
    const r = spawnSync(cmd, ["root", "-g"], { encoding: "utf8", stdio: "pipe" });
    return r.status === 0 ? r.stdout?.trim() || "" : "";
  };
  const pnpmRoot = probe("pnpm");
  const npmRoot = probe("npm");
  if (pnpmRoot && selfDir.startsWith(pnpmRoot)) return "pnpm";
  if (npmRoot && selfDir.startsWith(npmRoot)) return "npm";
  // pnpm's global store path contains a "/pnpm/" segment.
  if (/[\\/]pnpm[\\/]/.test(selfDir)) return "pnpm";
  return "npm";
}

// What to do with a running daemon around the install.
//
// This used to ask `apx daemon status --json`, a flag that command never had:
// it printed its coloured status block, JSON.parse threw, and the answer was
// "not running" on every machine, every time. So `apx update` never stopped
// the daemon and never started it again — npm swapped the files underneath a
// process still holding the old code in memory. The terminal said the new
// version; the panel kept reporting the old one through F5, since /api/health
// answers from the process, and a new bundle talking to an old daemon lost the
// agents and chats. Only a manual `apx restart` put it right.
//
// After the install the restart is `apx restart`, run by name so PATH resolves
// the NEW install — the same command that already fixed it by hand, and the
// one that also brings a running desktop window along.
//
// Stopping BEFORE the install is only for Windows, where Node holds its files
// open. Anywhere else it is worse than useless: a daemon supervised by
// launchd/systemd (KeepAlive / Restart=always) is respawned the moment it
// exits — from the half-replaced tree npm is still writing.
export function daemonPlan({ running, platform = process.platform }) {
  if (!running) return { stopBefore: false, after: null };
  if (platform === "win32") return { stopBefore: true, after: "start" };
  return { stopBefore: false, after: "restart" };
}

export async function cmdUpdate(args, currentVersion) {
  const force = args.flags.force || args.flags.yes || args.flags.y;

  apxBanner(currentVersion, "update");
  console.log("Checking for updates...");
  const latest = await getLatestVersion();

  if (!latest) {
    console.error("Could not reach npm registry. Check your connection.");
    process.exit(1);
  }

  if (!isNewer(currentVersion, latest)) {
    console.log(`✅ Already up to date (${currentVersion})`);
    return;
  }

  console.log(`\n  Current: ${currentVersion}`);
  console.log(`  Latest:  ${latest}`);

  if (!force) {
    const confirmed = await confirm(`\nUpdate to ${latest}? [y/N] `);
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  const plan = daemonPlan({ running: await http.ping() });
  if (plan.stopBefore) {
    process.stdout.write("\nStopping daemon... ");
    spawnSync("apx", ["daemon", "stop"], { stdio: "inherit" });
    console.log("stopped.");
  }

  // Install with whichever package manager owns this apx install. npm is the
  // default (most installs predate the move to pnpm). pnpm is used first only
  // when it owns the install AND its global bin directory is configured.
  // The other package manager is always kept as a fallback so a misconfigured
  // pnpm never blocks the update.
  const pnpmStep = ["pnpm", ["add", "-g", `${PACKAGE_NAME}@${latest}`]];
  const npmStep = ["npm", ["install", "-g", `${PACKAGE_NAME}@${latest}`]];
  const pnpmUsable = hasPnpmGlobal();
  const steps =
    detectInstaller() === "pnpm" && pnpmUsable
      ? [pnpmStep, npmStep]
      : pnpmUsable
        ? [npmStep, pnpmStep]
        : [npmStep];

  let result;
  for (let i = 0; i < steps.length; i++) {
    const [pm, installArgs] = steps[i];
    console.log(`\nInstalling ${PACKAGE_NAME}@${latest} via ${pm}...\n`);
    result = spawnSync(pm, installArgs, { stdio: "inherit" });
    if (result.status === 0) break;
    const next = steps[i + 1];
    if (next) {
      console.log(`\n⚠️  ${pm} install failed — retrying with ${next[0]}...`);
    }
  }

  if (result.status !== 0) {
    console.error(`\n❌ Update failed (exit ${result.status})`);
    // Only a daemon we stopped needs bringing back; otherwise the old one
    // never went anywhere.
    if (plan.stopBefore) {
      console.log("Restarting daemon with old version...");
      spawnSync("apx", ["daemon", "start"], { stdio: "inherit" });
    }
    process.exit(result.status || 1);
  }

  if (plan.after === "start") {
    process.stdout.write("\nStarting daemon... ");
    spawnSync("apx", ["daemon", "start"], { stdio: "inherit" });
    console.log("done.");
  } else if (plan.after === "restart") {
    console.log("\nRestarting daemon on the new version...");
    const r = spawnSync("apx", ["restart"], { stdio: "inherit" });
    if (r.status !== 0) {
      // Say it, rather than leaving the half-updated state to be discovered
      // in the panel.
      console.error("\n⚠️  The daemon did not restart. Run: apx restart");
    }
  }

  console.log(`\n✅ Updated to ${latest}.`);
}

function confirm(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
