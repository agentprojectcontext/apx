#!/usr/bin/env node
// Who may push to `main`, and what they must pass first (AGENTS.md rule 19).
//
//   - Work happens on `staging` or a feature branch. `main` receives it by
//     merge, and only once the e2e gate (scripts/e2e-gate.js) is green.
//   - The one exception is a HOTFIX, which may land on main directly — but it
//     still passes preflight AND the e2e gate. It skips staging, not the tests.
//
// A hotfix is identified in one of two ways, both explicit:
//   1. it is pushed from a `hotfix/<slug>` branch (git push origin hotfix/x:main);
//   2. the pusher says so: `APX_HOTFIX=1 git push`.
//
// Everything else pushed to main must already live on another branch — that is
// what "it went through staging or a feature branch" means in git terms. A
// commit made on local main and pushed straight up is refused with the reason.
//
// The pre-push hook pipes git's stdin through here. Exit 0 = allowed; the
// last stdout line is `gate` when the e2e gate must run, `no-gate` otherwise.
// Exit 1 = refused, reason on stderr.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MAIN_REF = "refs/heads/main";
const ZERO = /^0+$/;

/**
 * Pure decision for ONE pushed ref.
 *
 * @param {object} p
 * @param {string} p.localRef   e.g. refs/heads/staging
 * @param {string} p.remoteRef  e.g. refs/heads/main
 * @param {boolean} p.deleting  local sha is all zeros
 * @param {Array<{sha: string, merge: boolean, elsewhere: boolean}>} p.commits
 *        commits new to the remote; `elsewhere` = reachable from a branch other
 *        than main (local or remote)
 * @param {boolean} p.hotfixEnv APX_HOTFIX=1
 */
export function decide({ localRef, remoteRef, deleting = false, commits = [], hotfixEnv = false }) {
  if (remoteRef !== MAIN_REF) return { allowed: true, gate: false, reason: "not main" };
  if (deleting) return { allowed: false, gate: false, reason: "refusing to delete main" };

  const hotfix = hotfixEnv || /^refs\/heads\/hotfix\//.test(localRef || "");
  if (hotfix) return { allowed: true, gate: true, hotfix: true, reason: "hotfix to main: preflight + e2e gate" };

  const direct = commits.filter((c) => !c.merge && !c.elsewhere);
  if (direct.length) {
    return {
      allowed: false,
      gate: false,
      reason:
        `${direct.length} commit(s) exist only on main (${direct.map((c) => c.sha.slice(0, 7)).join(", ")}). ` +
        "Work goes on `staging` or a feature branch and reaches main by merge. " +
        "If this IS a hotfix, push it from a `hotfix/<slug>` branch or with APX_HOTFIX=1.",
    };
  }
  return { allowed: true, gate: true, hotfix: false, reason: "merge to main: preflight + e2e gate" };
}

/** Parse git's pre-push stdin: `<local ref> <local sha> <remote ref> <remote sha>` per line. */
export function parsePushLines(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length === 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha }));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Commits the remote does not have yet, each tagged merge / elsewhere. */
function newCommits(localSha, remoteSha) {
  const range = ZERO.test(remoteSha) ? [localSha, "--not", "--remotes"] : [`${remoteSha}..${localSha}`];
  const out = git(["rev-list", "--parents", ...range]);
  if (!out) return [];
  const branches = git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])
    .split("\n")
    .filter((r) => r && !/\/main$/.test(r) && !/\/HEAD$/.test(r));
  return out.split("\n").map((line) => {
    const [sha, ...parents] = line.split(" ");
    let elsewhere = false;
    for (const ref of branches) {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", sha, ref], { stdio: "ignore" });
        elsewhere = true;
        break;
      } catch { /* not in this one */ }
    }
    return { sha, merge: parents.length > 1, elsewhere };
  });
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let gate = false;
  for (const line of parsePushLines(input)) {
    const deleting = ZERO.test(line.localSha);
    const commits = line.remoteRef === MAIN_REF && !deleting ? newCommits(line.localSha, line.remoteSha) : [];
    const d = decide({ ...line, deleting, commits, hotfixEnv: process.env.APX_HOTFIX === "1" });
    if (!d.allowed) {
      console.error(`push-policy: ${line.localRef} → ${line.remoteRef} refused: ${d.reason}`);
      process.exit(1);
    }
    if (d.gate) console.error(`push-policy: ${line.localRef} → ${line.remoteRef}: ${d.reason}`);
    gate = gate || d.gate;
  }
  console.log(gate ? "gate" : "no-gate");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`push-policy: ${e?.message || e}`);
    process.exit(1);
  });
}
