// Importing skills from a folder, a .zip or a git repository. The source is read where it is (a zip or a clone in a
// temporary folder that is removed after), each skill found is listed with what to look at, and the picked ones are
// copied as regular files only. Nothing in them runs, and links are never followed out of the source.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SkillCandidate, SkillImportSource } from "@apx/protocol";
import { parseFrontmatter, textField } from "../apc/frontmatter.ts";
import { expandHome, isInside } from "../paths.ts";
import { APX_SKILLS_DIR } from "./skills.ts";
import { readZip } from "./zip.ts";

/** What one skill may bring: more than this is left out and said in its notes. */
const MAX_FILES = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_BYTES = 8 * 1024 * 1024;
/** How deep in a repo or zip skills are looked for (`skills/<group>/<name>/SKILL.md` is three). */
const MAX_DEPTH = 4;
/** Folders looked into at most: a home or a disk's root given by mistake is refused, not walked. */
const MAX_DIRS = 3000;
const CLONE_MS = 60_000;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const NEVER = new Set([".git", "node_modules"]);
const SCRIPT = /\.(sh|bash|zsh|fish|py|js|mjs|cjs|ts|rb|pl|php|ps1|psm1|bat|cmd|exe|bin|jar)$/i;
/** Frontmatter APX reads or that only describes the skill; any other key is another app's setting. */
const PLAIN_KEYS = new Set(["name", "description", "license", "metadata", "version", "compatibility", "tags"]);

/** Runs git; tests pass their own. Resolves with the exit code and the tail of its output. */
export type GitRunner = (args: string[], timeoutMs: number) => Promise<{ code: number; out: string }>;

export const runGit: GitRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn("git", args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      // Never a password prompt, and large files stay pointers: a skill is text.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
    });
    let out = "";
    const keep = (d: Buffer) => {
      out = (out + d.toString()).slice(-2000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (err) => resolve({ code: 1, out: err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });

export type RepoRef = { clone: string; ref?: string | undefined; sub?: string | undefined };

/**
 * A repository address as git takes it: https or ssh only (no local paths, no `ext::`). A GitHub page of a folder
 * (`…/tree/<branch>/<path>`) or of a file in it (`…/blob/…/SKILL.md`) clones that branch and reads that folder.
 */
export function parseRepoUrl(input: string): RepoRef {
  const url = input.trim();
  const page = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/(tree|blob)\/([^/]+)\/?(.*)$/.exec(url);
  if (page) {
    const [, owner, repo, kind, ref, rest = ""] = page;
    const sub = kind === "blob" ? path.posix.dirname(rest) : rest.replace(/\/$/, "");
    return { clone: `https://github.com/${owner}/${repo}.git`, ref, sub: sub && sub !== "." ? sub : undefined };
  }
  if (
    /^https:\/\/[^\s/@]+(:\d+)?\/\S+$/.test(url) ||
    /^ssh:\/\/\w\S*$/.test(url) ||
    /^\w[\w.-]*@\w[\w.-]*:\S+$/.test(url)
  )
    return { clone: url };
  throw new Error("give a git repository address that starts with https:// or ssh (git@host:owner/repo)");
}

/** A source read in a folder; `done` removes what reading it left behind. */
type Staged = { root: string; label: string; done(): void };

const tempDir = (kind: string) => fs.mkdtempSync(path.join(os.tmpdir(), `apx-skill-${kind}-`));

async function stage(source: SkillImportSource, git: GitRunner): Promise<Staged> {
  if (source.kind === "folder") {
    const root = path.resolve(expandHome(source.path.trim()));
    if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no folder at ${source.path}`);
    return { root, label: path.basename(root), done: () => {} };
  }
  if (source.kind === "zip") {
    const buf = Buffer.from(source.data.replace(/^data:[^,]*,/, ""), "base64");
    const { files } = readZip(buf, { entries: MAX_FILES * 20, bytes: MAX_SKILL_BYTES * 4 });
    const root = tempDir("zip");
    for (const f of files) {
      const file = path.join(root, ...f.path.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, f.data, { flag: "wx" });
    }
    const label = (source.name ?? "skill").replace(/\.zip$/i, "");
    return { root, label: path.basename(label), done: () => fs.rmSync(root, { recursive: true, force: true }) };
  }
  const repo = parseRepoUrl(source.url);
  const dir = tempDir("repo");
  const done = () => fs.rmSync(dir, { recursive: true, force: true });
  const clone = path.join(dir, "repo");
  const r = await git(
    [
      // Only https and ssh, whatever the owner's git config allows; links checked out as plain files.
      ...["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always"],
      ...["-c", "core.symlinks=false"],
      ...["clone", "--depth", "1", "--no-tags", "--single-branch"],
      ...(repo.ref ? ["--branch", repo.ref] : []),
      "--",
      repo.clone,
      clone,
    ],
    CLONE_MS,
  );
  if (r.code !== 0) {
    done();
    throw new Error(`git clone failed: ${r.out.trim().split("\n").at(-1) ?? "no answer"}`);
  }
  const root = repo.sub ? path.join(clone, ...repo.sub.split("/")) : clone;
  if (!isInside(clone, root) || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    done();
    throw new Error(`no folder ${repo.sub} in that repository`);
  }
  const label = path.basename(repo.sub ?? repo.clone.replace(/\.git$/, "").replace(/[:/]+$/, ""));
  return { root, label, done };
}

/** Folders (relative, "." for the root) holding a SKILL.md, without following links. A skill's own subfolders count. */
export function findSkillDirs(root: string): string[] {
  const out: string[] = [];
  let seen = 0;
  const walk = (rel: string, depth: number) => {
    if (++seen > MAX_DIRS) throw new Error("that folder holds too much: point at the skill, or the folder of skills");
    const dir = path.join(root, rel);
    const file = fs.lstatSync(path.join(dir, "SKILL.md"), { throwIfNoEntry: false });
    if (file?.isFile()) out.push(rel || ".");
    if (depth >= MAX_DEPTH) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
      if (e.isDirectory() && !e.name.startsWith(".") && !NEVER.has(e.name)) walk(path.join(rel, e.name), depth + 1);
  };
  walk("", 0);
  return out;
}

type Found = { path: string; abs: string; bytes: number };

/** A skill's regular files, within the limits; what is left out (links, oversized, past the count) is named. */
function filesOf(dir: string): { files: Found[]; skipped: string[]; scripts: string[] } {
  const files: Found[] = [];
  const skipped: string[] = [];
  const scripts: string[] = [];
  let total = 0;
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (NEVER.has(e.name) || e.name === ".DS_Store") continue;
      if (e.isDirectory()) {
        walk(r);
        continue;
      }
      const abs = path.join(dir, ...r.split("/"));
      const st = fs.lstatSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES || files.length >= MAX_FILES || total + st.size > MAX_SKILL_BYTES) {
        skipped.push(r);
        continue;
      }
      total += st.size;
      files.push({ path: r, abs, bytes: st.size });
      if (SCRIPT.test(e.name) || st.mode & 0o111) scripts.push(r);
    }
  };
  walk("");
  return { files, skipped, scripts };
}

/** Where picked skills land, and what is already there. */
export type ImportTarget = {
  /** `<home>/skills` or a project's `.apc/skills`. */
  dir: string;
  /** For a project: its folder, so no link on the way out of it is written through. */
  repo?: string | undefined;
};

/** Names of APX's own skills: never taken by an imported one. */
const apxNames = () =>
  new Set(fs.readdirSync(APX_SKILLS_DIR).filter((n) => fs.existsSync(path.join(APX_SKILLS_DIR, n, "SKILL.md"))));

type Read = Omit<SkillCandidate, "files"> & { files: Found[] };

function readCandidate(root: string, rel: string, label: string, target: ImportTarget, reserved: Set<string>): Read {
  const dir = rel === "." ? root : path.join(root, ...rel.split("/"));
  const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  const { fields } = parseFrontmatter(text);
  const name = textField(fields.name)?.trim() || (rel === "." ? label : path.basename(rel));
  const description = (textField(fields.description) ?? "").replace(/\s+/g, " ").trim();
  const { files, skipped, scripts } = filesOf(dir);
  const appOnly = Object.keys(fields).filter((k) => !PLAIN_KEYS.has(k));
  const status = !NAME.test(name)
    ? "invalid"
    : reserved.has(name)
      ? "reserved"
      : fs.lstatSync(path.join(target.dir, name), { throwIfNoEntry: false })
        ? "exists"
        : "new";
  return {
    id: rel,
    name,
    description,
    folder: name,
    files,
    notes: [
      ...(scripts.length ? [{ kind: "scripts" as const, items: scripts }] : []),
      ...(appOnly.length ? [{ kind: "app_only" as const, items: appOnly }] : []),
      ...(skipped.length ? [{ kind: "skipped" as const, items: skipped }] : []),
    ],
    status,
  };
}

const publicCandidate = (c: Read): SkillCandidate => ({
  ...c,
  files: c.files.map((f) => ({ path: f.path, bytes: f.bytes })),
});

async function read<T>(
  source: SkillImportSource,
  target: ImportTarget,
  git: GitRunner,
  then: (found: Read[]) => T,
): Promise<T> {
  const staged = await stage(source, git);
  try {
    const reserved = apxNames();
    const dirs = findSkillDirs(staged.root);
    if (!dirs.length) throw new Error("no SKILL.md found there");
    return then(dirs.map((rel) => readCandidate(staged.root, rel, staged.label, target, reserved)));
  } finally {
    staged.done();
  }
}

/** The skills in a source, with their files and notes; nothing is kept. */
export function previewSkills(source: SkillImportSource, target: ImportTarget, git: GitRunner = runGit) {
  return read(source, target, git, (found) => found.map(publicCandidate));
}

/** Refuses a target whose way out of the project goes through a link (`.apc` or `.apc/skills`). */
function checkTarget(target: ImportTarget): void {
  if (!target.repo) return;
  for (let p = target.dir; isInside(target.repo, p) && p !== target.repo; p = path.dirname(p))
    if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(`refusing to write through a symlink: ${path.relative(target.repo, p)}`);
}

/**
 * Copies the picked skills into the target: into a fresh folder beside it first, then put in place, so a failed copy
 * leaves nothing half written and an existing skill is replaced only once its new copy is whole.
 */
export function importSkills(
  source: SkillImportSource,
  target: ImportTarget,
  opts: { pick: string[]; replace: boolean },
  git: GitRunner = runGit,
): Promise<{ imported: string[]; skipped: Array<{ id: string; reason: string }> }> {
  return read(source, target, git, (found) => {
    checkTarget(target);
    const imported: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const byId = new Map(found.map((c) => [c.id, c]));
    for (const id of new Set(opts.pick)) {
      const c = byId.get(id);
      const reason = !c
        ? "not found in the source"
        : c.status === "invalid"
          ? `"${c.name}" is not a usable skill name`
          : c.status === "reserved"
            ? `${c.name} is one of APX's own skills`
            : c.status === "exists" && !opts.replace
              ? `${c.name} is already there`
              : undefined;
      if (!c || reason) {
        skipped.push({ id, reason: reason ?? "skipped" });
        continue;
      }
      fs.mkdirSync(target.dir, { recursive: true });
      const dest = path.join(target.dir, c.folder);
      const fresh = path.join(target.dir, `.${c.folder}.import-${randomBytes(4).toString("hex")}`);
      try {
        for (const f of c.files) {
          const file = path.join(fresh, ...f.path.split("/"));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.copyFileSync(f.abs, file, fs.constants.COPYFILE_EXCL);
        }
        // A link in its place (a skill linked from another app) is removed, never what it points to.
        const there = fs.lstatSync(dest, { throwIfNoEntry: false });
        if (there?.isSymbolicLink()) fs.unlinkSync(dest);
        else if (there) fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(fresh, dest);
      } catch (err) {
        fs.rmSync(fresh, { recursive: true, force: true });
        throw err;
      }
      imported.push(dest);
    }
    return { imported, skipped };
  });
}
