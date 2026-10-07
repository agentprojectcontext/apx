// The owner working a project's repository from the panel: status, staging, committing and history. Every path stays
// inside the repository and away from .git; git runs with the repository unable to make it run anything (no hooks).
import path from "node:path";
import type { GitCommit, GitFile } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { git } from "../engine/changes.ts";
import { badRequest, notFound } from "../errors.ts";
import { insideReal } from "../paths.ts";
import type { Handlers } from "./router.ts";

/** The most of one diff the panel shows. */
const MAX_DIFF = 200 * 1024;
/** Unit and record separators: a subject or a ref never holds them. */
const US = "\x1f";
const RS = "\x1e";
const FORMAT = ["%H", "%s", "%an", "%aI", "%D"].join("%x1f");

/** git's own message (its first line), as a refusal the owner can read. */
const refused = (e: unknown) => {
  const err = e as { stderr?: string; message?: string };
  const line = (err.stderr || err.message || "git failed").trim().split("\n")[0] ?? "git failed";
  return badRequest(line.replace(/^(fatal|error): /, ""));
};

const cut = (diff: string) =>
  diff.length > MAX_DIFF ? { diff: diff.slice(0, MAX_DIFF), truncated: true } : { diff, truncated: false };

/** `-z` lists: "<a>\t<r>\t<path>" or, for a rename, "<a>\t<r>\t" then the old and the new path. */
function numstat(out: string): Map<string, { added: number; removed: number }> {
  const counts = new Map<string, { added: number; removed: number }>();
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const [a, r, file] = (parts[i] ?? "").split("\t");
    if (a === undefined || r === undefined) continue;
    let p = file;
    if (p === "") {
      i += 2;
      p = parts[i];
    }
    if (p && a !== "-") counts.set(p, { added: Number(a), removed: Number(r) });
  }
  return counts;
}

/** `--name-status -z`: a status, then the path (a rename or copy: the old path, then the new). */
function nameStatus(out: string, counts: Map<string, { added: number; removed: number }>): GitFile[] {
  const parts = out.split("\0");
  const files: GitFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!code) continue;
    const letter = code[0] ?? "M";
    let from: string | undefined;
    if (letter === "R" || letter === "C") from = parts[++i];
    const p = parts[++i];
    if (!p) continue;
    files.push({ path: p, status: letter, ...(from ? { from } : {}), ...(counts.get(p) ?? {}) });
  }
  return files;
}

const commitOf = (record: string): GitCommit | undefined => {
  const [sha, subject, author, at, refs] = record.replace(/^\n+/, "").split(US);
  if (!sha || !at) return undefined;
  return {
    sha,
    subject: subject ?? "",
    author: author ?? "",
    at,
    refs: (refs ?? "")
      .split(", ")
      .map((r) => r.replace(/^HEAD -> /, "").trim())
      .filter((r) => r && r !== "HEAD"),
  };
};

export function gitHandlers(store: Store) {
  /** The repository's root for a project's folder; undefined when the folder is not in one. */
  const rootOf = async (project: string): Promise<string | undefined> => {
    const p = store.projects.get(project);
    if (!p) throw notFound(`project ${project}`);
    if (!p.path || !p.present) throw badRequest(`${p.name} has no folder on this machine`);
    return git(p.path, ["rev-parse", "--show-toplevel"]).then(
      (r) => r.trim() || undefined,
      () => undefined,
    );
  };
  const repo = async (project: string) => {
    const root = await rootOf(project);
    if (!root) throw badRequest("this project's folder is not a git repository");
    return root;
  };
  /** A path git is handed: inside the repository, never .git, and taken literally (no globs). */
  const spec = (root: string, p: string) => {
    const clean = p.replace(/\\/g, "/");
    if (path.isAbsolute(clean) || !insideReal(root, clean) || clean.split("/").some((s) => s.toLowerCase() === ".git"))
      throw badRequest(`${p} is outside the repository`);
    return `:(literal)${clean}`;
  };
  const parentOf = async (root: string, sha: string) => {
    const line = (await git(root, ["rev-list", "--parents", "-n", "1", sha]).catch((e) => Promise.reject(refused(e))))
      .trim()
      .split(" ");
    // A first commit is compared with the empty tree.
    return line[1] ?? (await git(root, ["hash-object", "-t", "tree", "/dev/null"])).trim();
  };

  return {
    "git.status": async ({ project }) => {
      const root = await rootOf(project);
      if (!root) return { repo: false, staged: [], unstaged: [] };
      const [status, cached, work] = await Promise.all([
        git(root, ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"]),
        git(root, ["diff", "--no-ext-diff", "--no-textconv", "--cached", "--numstat", "-z"]).catch(() => ""),
        git(root, ["diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z"]).catch(() => ""),
      ]).catch((e) => Promise.reject(refused(e)));
      const stagedCounts = numstat(cached);
      const workCounts = numstat(work);
      const staged: GitFile[] = [];
      const unstaged: GitFile[] = [];
      let branch: string | undefined;
      let upstream: string | undefined;
      let ahead = 0;
      let behind = 0;
      const parts = status.split("\0");
      for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (!entry) continue;
        if (entry.startsWith("## ")) {
          // "## main...origin/main [ahead 2, behind 1]", "## No commits yet on main", "## HEAD (no branch)".
          const head = entry.slice(3);
          const m = /^(?:No commits yet on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head);
          branch = m?.[1];
          upstream = m?.[2];
          ahead = Number(/ahead (\d+)/.exec(m?.[3] ?? "")?.[1] ?? 0);
          behind = Number(/behind (\d+)/.exec(m?.[3] ?? "")?.[1] ?? 0);
          continue;
        }
        const x = entry[0] ?? " ";
        const y = entry[1] ?? " ";
        const p = entry.slice(3);
        const from = x === "R" || x === "C" ? parts[++i] : undefined;
        if (x === "?") {
          unstaged.push({ path: p, status: "?" });
          continue;
        }
        if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
          unstaged.push({ path: p, status: "U" });
          continue;
        }
        if (x !== " ") staged.push({ path: p, status: x, ...(from ? { from } : {}), ...(stagedCounts.get(p) ?? {}) });
        if (y !== " ") unstaged.push({ path: p, status: y, ...(workCounts.get(p) ?? {}) });
      }
      return {
        repo: true,
        root,
        ...(branch ? { branch } : {}),
        ...(upstream ? { upstream, ahead, behind } : {}),
        staged,
        unstaged,
      };
    },
    "git.diff": async ({ project, path: p, staged }) => {
      const root = await repo(project);
      const s = spec(root, p);
      const base = ["diff", "--no-ext-diff", "--no-textconv"];
      let diff = await git(root, [...base, ...(staged ? ["--cached"] : []), "--", s]).catch(() => "");
      if (!diff && !staged) {
        const tracked = await git(root, ["ls-files", "--", s]).catch(() => "");
        // An untracked file: all of it as added (`--no-index` exits 1 when the files differ, which they do).
        if (!tracked.trim())
          diff = await git(root, [...base, "--no-index", "--", "/dev/null", s.slice(":(literal)".length)]).catch(
            (e: { stdout?: string }) => e.stdout ?? "",
          );
      }
      return { path: p, ...cut(diff) };
    },
    "git.stage": async ({ project, paths }) => {
      const root = await repo(project);
      const specs = paths.map((p) => spec(root, p));
      await git(root, ["add", "--all", "--", ...specs]).catch((e) => Promise.reject(refused(e)));
      return { ok: true as const };
    },
    "git.unstage": async ({ project, paths }) => {
      const root = await repo(project);
      const specs = paths.map((p) => spec(root, p));
      // Before the first commit there is no HEAD to reset to: the files leave the index instead.
      const born = await git(root, ["rev-parse", "--verify", "-q", "HEAD"]).then(
        () => true,
        () => false,
      );
      const args = born ? ["reset", "-q", "HEAD", "--", ...specs] : ["rm", "-q", "--cached", "-r", "--", ...specs];
      await git(root, args).catch((e) => Promise.reject(refused(e)));
      return { ok: true as const };
    },
    "git.commit": async ({ project, message }) => {
      const root = await repo(project);
      await git(root, ["commit", "--no-verify", "-q", "-m", message], 30_000).catch((e) => Promise.reject(refused(e)));
      return { sha: (await git(root, ["rev-parse", "HEAD"])).trim() };
    },
    "git.log": async ({ project, limit, skip }) => {
      const root = await repo(project);
      const out = await git(root, [
        "log",
        `--max-count=${limit + 1}`,
        `--skip=${skip}`,
        `--format=${FORMAT}%x1e`,
        "--decorate=short",
      ]).catch((e: { stderr?: string }) =>
        // A repository with no commits yet has no history, not an error.
        /does not have any commits/.test(e.stderr ?? "") ? "" : Promise.reject(refused(e)),
      );
      const commits = out
        .split(RS)
        .map(commitOf)
        .filter((c): c is GitCommit => Boolean(c));
      return { commits: commits.slice(0, limit), more: commits.length > limit };
    },
    "git.show": async ({ project, sha }) => {
      const root = await repo(project);
      const head = await git(root, ["show", "-s", `--format=${FORMAT}%x1f%b`, "--decorate=short", sha]).catch((e) =>
        Promise.reject(refused(e)),
      );
      const commit = commitOf(head);
      if (!commit) throw notFound(`commit ${sha}`);
      const body = head.split(US).slice(5).join(US).trim();
      const parent = await parentOf(root, commit.sha);
      const range = [parent, commit.sha];
      const [names, counts] = await Promise.all([
        git(root, ["diff", "--no-ext-diff", "--no-textconv", "-M", "--name-status", "-z", ...range]),
        git(root, ["diff", "--no-ext-diff", "--no-textconv", "-M", "--numstat", "-z", ...range]),
      ]);
      return { commit, body, files: nameStatus(names, numstat(counts)) };
    },
    "git.commit_diff": async ({ project, sha, path: p }) => {
      const root = await repo(project);
      const s = spec(root, p);
      const parent = await parentOf(root, sha);
      const diff = await git(root, ["diff", "--no-ext-diff", "--no-textconv", parent, sha, "--", s]).catch((e) =>
        Promise.reject(refused(e)),
      );
      return { path: p, ...cut(diff) };
    },
  } satisfies Partial<Handlers>;
}
