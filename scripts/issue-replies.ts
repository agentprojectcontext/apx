#!/usr/bin/env node
// Once a v2 release is out, answers the issues it fixes: each commit since the previous v2 tag that ends with an
// `Issue: #N` trailer gets a comment on issue N (which commit, in which version, how to update) and the issue is
// closed. A comment already there for that version is not posted twice.
//   TAG=v2.3.28 node scripts/issue-replies.ts [--dry]     (needs `gh`, logged in or with GH_TOKEN)
import { execFileSync } from "node:child_process";
import { previousTag } from "./discord-release.ts";

const REPO = "agentprojectcontext/apx";

export type Fix = { issue: number; sha: string; subject: string };

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8" }).trim();

/** The `Issue:` trailers of `git log --format=%h%x00%s%x00%(trailers:key=Issue,valueonly,separator=%x2C)%x1e`. */
export function fixesIn(log: string): Fix[] {
  return log
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [sha = "", subject = "", trailers = ""] = record.split("\0");
      return [...trailers.matchAll(/#?(\d+)/g)].map((m) => ({ issue: Number(m[1]), sha, subject }));
    });
}

/** `fix(core): a chat turn gets 60 steps` → "A chat turn gets 60 steps". */
const plain = (subject: string) => {
  const s = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, "");
  return s.startsWith("apx ") ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
};

/** What the issue is told: every commit of the release that names it. */
export function replyFor(tag: string, fixes: Fix[]): string {
  const lines = fixes.map((f) => `- ${plain(f.subject)} (${f.sha})`);
  return [
    `Released in APX ${tag}:`,
    "",
    ...lines,
    "",
    "The desktop app offers the update by itself; on a server, run `apx upgrade`. " +
      `Release notes: https://github.com/${REPO}/releases/tag/${tag}`,
  ].join("\n");
}

if (import.meta.main) {
  const tag = process.env.TAG ?? "";
  if (!/^v2\.\d+\.\d+$/.test(tag)) throw new Error(`TAG must be a v2 version tag, got "${tag}"`);
  const previous = previousTag(tag, git("tag", "--list", "v2.*").split("\n"));
  const log = git(
    "log",
    "--no-merges",
    "--format=%h%x00%s%x00%(trailers:key=Issue,valueonly,separator=%x2C)%x1e",
    previous ? `${previous}..${tag}` : tag,
  );
  const byIssue = Map.groupBy(fixesIn(log), (f) => f.issue);
  if (!byIssue.size) console.log(`no commit in ${tag} names an issue`);
  for (const [issue, fixes] of byIssue) {
    const body = replyFor(tag, fixes);
    if (process.argv.includes("--dry")) {
      console.log(`#${issue}\n${body}\n`);
      continue;
    }
    // The release is out already: one issue that cannot be answered only warns.
    try {
      const said = gh("issue", "view", String(issue), "-R", REPO, "--json", "comments", "-q", ".comments[].body");
      if (said.includes(`Released in APX ${tag}:`)) {
        console.log(`#${issue}: already answered for ${tag}`);
        continue;
      }
      gh("issue", "comment", String(issue), "-R", REPO, "--body", body);
      const state = gh("issue", "view", String(issue), "-R", REPO, "--json", "state", "-q", ".state");
      if (state === "OPEN") gh("issue", "close", String(issue), "-R", REPO, "--reason", "completed");
      console.log(`#${issue}: answered and closed for ${tag}`);
    } catch (err) {
      console.log(`::warning::#${issue}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
}
