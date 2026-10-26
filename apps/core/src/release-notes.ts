#!/usr/bin/env node
// What changed in each APX release: the commits between two v2 tags, each subject as a sentence (the same sentences
// the Discord announcement and the issue replies use). A packaged APX carries them in release-notes.json beside
// build.json, written when it is staged; a checkout reads them from its own git. See DECISIONS.md#d-100
//   node apps/core/src/release-notes.ts <file>     writes this checkout's notes (stage.ts calls it)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_REPO = "agentprojectcontext/apx";
/** How many releases a build carries: an install that skipped more is told the newest ones. */
const CARRIED = 20;
const KINDS = ["feat", "fix", "perf"] as const;

export type Change = { kind: (typeof KINDS)[number]; text: string; sha: string };
export type Release = { version: string; previous?: string; changes: Change[] };
export type ReleaseNotes = {
  /** The release this APX is ("2.3.33"). */
  version: string;
  /** The branch it was built from ("main"). */
  branch?: string;
  /** A checkout's folder, where `git log` reads the commits; none for a packaged APX. */
  repo_dir?: string;
  /** Newest first. */
  releases: Release[];
};

/** Where release notes come from: the version is cheap to ask on every start, the notes only once it changed. */
export type ReleaseSource = { version(): string | undefined; notes(): ReleaseNotes | undefined };

const key = (v: string) =>
  v
    .replace(/^v/, "")
    .split(/[-+]/)[0]
    ?.split(".")
    .map((n) => Number(n) || 0) ?? [];

/** Negative when `a` is an older version than `b` ("v2.3.9" before "2.3.10"). */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [key(a), key(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** The v2 tag before this one, by version (not by date). */
export function previousTag(tag: string, tags: string[]): string | undefined {
  return tags
    .filter((t) => /^v2\.\d+\.\d+$/.test(t) && compareVersions(t, tag) < 0)
    .sort((a, b) => compareVersions(b, a))[0];
}

/** `fix(core): a chat turn gets 60 steps` → "A chat turn gets 60 steps"; a command keeps its case (`apx …`). */
export function sentence(subject: string): string {
  const s = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, "");
  return s.startsWith("apx ") ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/** The changes people read in `git log --format=%h%x00%s%x1e`: what is new, fixed or faster. */
export function changesIn(log: string): Change[] {
  return log
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [sha = "", subject = ""] = record.split("\0");
      const kind = KINDS.find((k) => new RegExp(`^${k}(\\([^)]*\\))?!?:`).test(subject));
      return kind ? [{ kind, text: sentence(subject), sha }] : [];
    });
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** The release tag a checkout is at or past ("v2.3.32"), or none outside git or before any v2 tag. */
function tagOf(cwd: string): string | undefined {
  try {
    return git(cwd, "describe", "--tags", "--abbrev=0", "--match", "v2.*") || undefined;
  } catch {
    return undefined;
  }
}

/** The branch a build comes from: the checked-out one, else (a tag's detached checkout in CI) one holding it. */
function branchOf(cwd: string): string | undefined {
  try {
    const head = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
    if (head && head !== "HEAD") return head;
    const holding = git(cwd, "branch", "-r", "--contains", "HEAD", "--format=%(refname:short)")
      .split("\n")
      .map((b) => b.replace(/^origin\//, ""))
      .filter((b) => b && b !== "origin" && b !== "HEAD");
    return holding.includes("main") ? "main" : holding[0];
  } catch {
    return undefined;
  }
}

/** A checkout's notes, read from its tags and commits: the last CARRIED releases up to the one it is at. */
export function notesFromGit(cwd: string, branch = branchOf(cwd)): ReleaseNotes | undefined {
  const tag = tagOf(cwd);
  if (!tag) return undefined;
  const tags = git(cwd, "tag", "--list", "v2.*").split("\n").filter(Boolean);
  const shown = [tag, ...tags.filter((t) => compareVersions(t, tag) < 0)]
    .filter((t) => /^v2\.\d+\.\d+$/.test(t))
    .sort((a, b) => compareVersions(b, a))
    .slice(0, CARRIED);
  const releases = shown.map((t): Release => {
    const previous = previousTag(t, tags);
    // The first v2 tag has no range to read: its whole history is not "what changed".
    const changes = previous
      ? changesIn(git(cwd, "log", "--no-merges", "--format=%h%x00%s%x1e", `${previous}..${t}`))
      : [];
    return { version: t.slice(1), ...(previous ? { previous: previous.slice(1) } : {}), changes };
  });
  return { version: tag.slice(1), ...(branch ? { branch } : {}), releases };
}

/** release-notes.json as stage.ts wrote it, or none when absent or not notes. */
function readFile(file: string): ReleaseNotes | undefined {
  try {
    const notes = JSON.parse(fs.readFileSync(file, "utf8")) as ReleaseNotes;
    return typeof notes.version === "string" && Array.isArray(notes.releases) ? notes : undefined;
  } catch {
    return undefined;
  }
}

/** This APX's notes: the file a packaged build carries at `root`, else the checkout's git. */
export function localReleases(root: string): ReleaseSource {
  const file = path.join(root, "release-notes.json");
  if (fs.existsSync(file)) {
    const notes = readFile(file);
    return { version: () => notes?.version, notes: () => notes };
  }
  return {
    version: () => tagOf(root)?.slice(1),
    notes: () => {
      const notes = notesFromGit(root);
      return notes ? { ...notes, repo_dir: root } : undefined;
    },
  };
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: node apps/core/src/release-notes.ts <file>");
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const notes = notesFromGit(repo, process.env.APX_BRANCH || undefined);
  if (notes) fs.writeFileSync(out, `${JSON.stringify(notes, null, 2)}\n`);
  process.stdout.write(notes ? `release notes for ${notes.version} in ${out}\n` : "no v2 tag here: no release notes\n");
}
