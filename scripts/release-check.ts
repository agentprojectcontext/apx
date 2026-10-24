#!/usr/bin/env node
// Only a verified commit is tagged (AGENTS.md rule 28): before a v2.x.y tag, the commit's verify run on release/v2
// must have passed. release.yml's publish job checks the same run again, as a second guard.
//   node scripts/release-check.ts [ref]            # HEAD by default; exits 1 unless that commit is verified
//   node scripts/release-check.ts [ref] --wait     # a run still going is watched until it ends
//   node scripts/release-check.ts --tag v2.x.y [ref]   # then tags that commit and pushes the tag
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_BRANCH = "release/v2";
export const VERIFY_WORKFLOW = "verify.yml";
const DEFAULT_REPO = "agentprojectcontext/apx";

export type VerifyRun = { databaseId: number; status: string; conclusion: string; url: string; headSha: string };
export type Verdict = { verified: true; run: VerifyRun } | { verified: false; pending?: VerifyRun; reason: string };

/** The newest verify run of the commit decides, as the publish job reads it (`gh run list` is newest first). */
export function verdict(sha: string, runs: readonly VerifyRun[]): Verdict {
  const run = runs.find((r) => r.headSha === sha);
  if (!run)
    return { verified: false, reason: `no ${VERIFY_WORKFLOW} run on ${RELEASE_BRANCH} for ${sha}: push it first` };
  if (run.status !== "completed")
    return { verified: false, pending: run, reason: `verify is still ${run.status.replace("_", " ")}: ${run.url}` };
  if (run.conclusion !== "success")
    return { verified: false, reason: `verify ended in ${run.conclusion || "no conclusion"}: ${run.url}` };
  return { verified: true, run };
}

/** A version tag v2 releases: v2.<minor>.<patch>, nothing after it. */
export function isReleaseTag(tag: string): boolean {
  return /^v2\.\d+\.\d+$/.test(tag);
}

type Run = (command: string, args: string[], inherit?: boolean) => { status: number; stdout: string; stderr: string };

const exec: Run = (command, args, inherit = false) => {
  const r = spawnSync(command, args, { encoding: "utf8", stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
  if (r.error) throw r.error;
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

export function parseArgs(argv: readonly string[]) {
  const rest = [...argv];
  const take = (flag: string) => {
    const at = rest.indexOf(flag);
    if (at < 0) return undefined;
    const [, value] = rest.splice(at, 2);
    if (!value || value.startsWith("-")) throw new Error(`${flag} needs a value`);
    return value;
  };
  const wait = rest.includes("--wait");
  const tag = take("--tag");
  const repo = take("--repo") ?? process.env.APX_RELEASE_REPO ?? DEFAULT_REPO;
  const positional = rest.filter((a) => a !== "--wait");
  if (positional.some((a) => a.startsWith("-")))
    throw new Error(`unknown flag ${positional.find((a) => a.startsWith("-"))}`);
  if (positional.length > 1) throw new Error("one ref at most");
  if (tag && !isReleaseTag(tag)) throw new Error(`${tag} is not a release tag (v2.x.y)`);
  return { ref: positional[0] ?? "HEAD", wait, tag, repo };
}

export function check(argv: readonly string[], run: Run = exec, log = console.log): number {
  const { ref, wait, tag, repo } = parseArgs(argv);
  const resolved = run("git", ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (resolved.status !== 0) {
    log(`release:check: ${ref} is not a commit here`);
    return 1;
  }
  const sha = resolved.stdout.trim();
  const list = () => {
    const out = run("gh", [
      "run",
      "list",
      "-R",
      repo,
      "--workflow",
      VERIFY_WORKFLOW,
      "--branch",
      RELEASE_BRANCH,
      "--commit",
      sha,
      "--limit",
      "20",
      "--json",
      "databaseId,status,conclusion,url,headSha",
    ]);
    if (out.status !== 0) throw new Error(`gh run list failed: ${out.stderr.trim()}`);
    return verdict(sha, JSON.parse(out.stdout) as VerifyRun[]);
  };
  let v = list();
  if (!v.verified && v.pending && wait) {
    log(`release:check: watching ${v.pending.url}`);
    run("gh", ["run", "watch", String(v.pending.databaseId), "-R", repo, "--interval", "30"], true);
    v = list();
  }
  if (!v.verified) {
    log(`release:check: ${sha.slice(0, 12)} is not verified — ${v.reason}`);
    return 1;
  }
  log(`release:check: ${sha.slice(0, 12)} passed verify (${v.run.url})`);
  if (!tag) return 0;
  for (const [command, args] of [
    ["git", ["tag", tag, sha]],
    ["git", ["push", "origin", `refs/tags/${tag}`]],
  ] as const) {
    if (run(command, [...args], true).status !== 0) {
      log(`release:check: ${command} ${args.join(" ")} failed`);
      return 1;
    }
  }
  log(`release:check: tagged ${sha.slice(0, 12)} as ${tag} and pushed it`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = check(process.argv.slice(2));
  } catch (error) {
    console.error(`release:check: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
