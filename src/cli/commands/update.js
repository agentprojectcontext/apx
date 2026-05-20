import { spawnSync } from "node:child_process";
import readline from "node:readline";
import { getLatestVersion } from "../../core/update-check.js";

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

function daemonRunning() {
  const r = spawnSync("apx", ["daemon", "status", "--json"], { encoding: "utf8", stdio: "pipe" });
  try { return JSON.parse(r.stdout)?.running === true; } catch { return false; }
}

export async function cmdUpdate(args, currentVersion) {
  const force = args.flags.force || args.flags.yes || args.flags.y;

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

  // Stop daemon before replacing the binary so Node doesn't lock files on Windows.
  const wasDaemonRunning = daemonRunning();
  if (wasDaemonRunning) {
    process.stdout.write("\nStopping daemon... ");
    spawnSync("apx", ["daemon", "stop"], { stdio: "inherit" });
    console.log("stopped.");
  }

  // Pick a package manager that can actually install global binaries. Prefer
  // pnpm only when its global bin directory is configured; otherwise npm. If
  // the first attempt fails, fall back to the other so a misconfigured pnpm
  // never blocks the update.
  const pnpmStep = ["pnpm", ["add", "-g", `${PACKAGE_NAME}@${latest}`]];
  const npmStep = ["npm", ["install", "-g", `${PACKAGE_NAME}@${latest}`]];
  const steps = hasPnpmGlobal() ? [pnpmStep, npmStep] : [npmStep];

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
    if (wasDaemonRunning) {
      console.log("Restarting daemon with old version...");
      spawnSync("apx", ["daemon", "start"], { stdio: "inherit" });
    }
    process.exit(result.status || 1);
  }

  // Restart daemon with new version.
  if (wasDaemonRunning) {
    process.stdout.write("\nStarting daemon... ");
    spawnSync("apx", ["daemon", "start"], { stdio: "inherit" });
    console.log("done.");
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
