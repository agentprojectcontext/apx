import { spawnSync } from "node:child_process";
import readline from "node:readline";
import { getLatestVersion } from "../../core/update-check.js";

const PACKAGE_NAME = "@agentprojectcontext/apx";

export async function cmdUpdate(args, currentVersion) {
  const force = args.flags.force || args.flags.yes || args.flags.y;

  console.log("Checking for updates...");
  const latest = await getLatestVersion();

  if (!latest) {
    console.error("Could not reach npm registry. Check your connection.");
    process.exit(1);
  }

  const current = currentVersion;

  function isNewer(cur, lat) {
    const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
    const [ma, mi, pa] = parse(cur);
    const [mb, mib, pb] = parse(lat);
    if (mb > ma) return true;
    if (mb === ma && mib > mi) return true;
    if (mb === ma && mib === mi && pb > pa) return true;
    return false;
  }

  if (!isNewer(current, latest)) {
    console.log(`✅ Already up to date (${current})`);
    return;
  }

  console.log(`\n  Current: ${current}`);
  console.log(`  Latest:  ${latest}`);

  if (!force) {
    const confirmed = await confirm(`\nUpdate to ${latest}? [y/N] `);
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  console.log(`\nRunning: npm install -g ${PACKAGE_NAME}@${latest}\n`);
  const result = spawnSync(
    "npm",
    ["install", "-g", `${PACKAGE_NAME}@${latest}`],
    { stdio: "inherit" }
  );

  if (result.status !== 0) {
    console.error(`\n❌ Update failed (exit ${result.status})`);
    process.exit(result.status || 1);
  }

  console.log(`\n✅ Updated to ${latest}. Restart any running apx daemon:`);
  console.log(`   apx daemon stop && apx daemon start`);
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
