// A throwaway HOME for a test run.
//
// Without one, `node --test` runs against the developer's real ~/.apx: tests
// read the config that happens to be on this machine, write into the ledger the
// daemon is using, and — because the runner executes files in parallel — race
// each other over both. That is not a hypothetical. On 2026-08-19 a test
// asserting `super_agent.model === "test:model"` intermittently read
// "zen:deepseek-v4-flash-free", which is a value that exists only in the
// developer's own config.
//
// test:ci has done this since it was written; the everyday `npm test` did not,
// which is why the flakes only ever bit locally. One helper, both runners.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * @param {string} label short tag for the temp directory name
 * @returns {{ home: string, env: NodeJS.ProcessEnv, cleanup: () => void }}
 */
export function makeTestHome(label = "apx-test-home") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  return {
    home,
    // USERPROFILE alongside HOME: os.homedir() reads that one on Windows, and a
    // suite that only moved HOME would still find the real profile there.
    //
    // APX_HOME explicitly, not just implied through HOME: computeHome() checks
    // APX_HOME FIRST and only falls back to os.homedir(). Relying on the HOME
    // fallback made isolation an import-order race — whichever module reached
    // config/paths.js first froze APX_HOME, and if that happened before a suite
    // moved HOME it froze to the developer's real ~/.apx. Pinning APX_HOME here
    // removes the race: the value is unambiguous no matter who imports when.
    env: { ...process.env, HOME: home, USERPROFILE: home, APX_HOME: path.join(home, ".apx") },
    cleanup() {
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // A leftover temp dir is noise, not a failure — never mask a result.
      }
    },
  };
}

/** Every `*.test.js` under `dir`, recursively, repo-relative and sorted. */
export function findTests(dir, repo) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTests(abs, repo));
    else if (entry.name.endsWith(".test.js")) out.push(path.relative(repo, abs));
  }
  return out.sort();
}
