// What a command line deletes, for the owner's card (DECISIONS.md#d-266): forced `rm`s and the git commands that throw
// away work git would otherwise keep. A static reading, as the destructive rule's, following the line's `cd`s and
// variables; where it runs, git says which files a restore would overwrite.
import path from "node:path";
import { expandHome } from "../paths.ts";
import { type Overwritten, overwritten } from "./command-git-status.ts";
import { shellCode } from "./command-heredocs.ts";
import { segments, type Word } from "./command-paths.ts";
import { normalize, withoutSearchPattern } from "./command-text.ts";

/** A forced or recursive deletion; `git rm` is git's own, judged by gitLoss. */
const FORCED_RM = /(?<!\bgit(?:[ \t]+[^\s;&|]+)*[ \t]+)\brm\b[^|;&]*\s(-\w*[rf]|--recursive|--force)/;
const forcedRm = (code: string) => FORCED_RM.test(code) || FORCED_RM.test(normalize(code));

/**
 * What a git command throws away, as the owner reads it on the card. `soft`: git refuses it when work would be lost
 * (`branch -d`, `worktree remove`), so it never asks by itself; it shows on a card another deletion opens.
 */
export type GitLoss = {
  what: "branch" | "worktree" | "untracked" | "changes" | "stash" | "stashes" | "commits";
  target: string;
  soft?: true;
};

/**
 * The paths a command's deletions remove, resolved from `cwd`; `later` holds what only the running command knows (a
 * variable it did not set, `$(…)`, `xargs rm`, `find -exec rm`, a script fed to a shell), as written; `git` what its
 * git commands throw away. `root`, set by the caller, is the folder the card shows paths relative to.
 */
export type Deletion = { paths: string[]; later: string[]; git: GitLoss[]; root?: string };

/** A git loss as one command states it: a restore's paths wait for git to say which hold edits. */
type Found = GitLoss & { restore?: "worktree" | "both" };

/** Text a shell is fed through a heredoc, read as the commands it is: the operator dropped, the body kept. */
const unwrapped = (code: string) => code.replace(/(?<!<)<<-?\s*(['"]?)([\w.-]+)\1/g, "");

const detectsDeletion = (code: string): boolean =>
  forcedRm(code) || segments(unwrapped(code)).some((s) => gitLoss(s.map((w) => w.text)).some((l) => !l.soft));
const deletionCode = (command: string) => withoutSearchPattern(shellCode(command.trim()), detectsDeletion);

/** Whether a command deletes: a forced `rm`, or a git command that discards work, a script fed to a shell included. */
export const deletes = (command: string): boolean => detectsDeletion(deletionCode(command));

/**
 * Whether a command deletes something where it runs (`cwd`): as `deletes`, except that a restore bringing back files
 * deleted in the working tree, or touching none with edits, loses nothing.
 */
export function losesWork(command: string, cwd: string, look: Overwritten = overwritten): boolean {
  if (!deletes(command)) return false;
  const d = deletionTargets(command, cwd, look);
  return d.paths.length > 0 || d.later.length > 0 || d.git.some((l) => !l.soft);
}

/** What a command deletes, read where it runs; `look` asks git which files a restore would overwrite. */
export function deletionTargets(command: string, cwd: string, look: Overwritten = overwritten): Deletion {
  const code = deletionCode(command);
  if (!detectsDeletion(code)) return { paths: [], later: [], git: [] };
  const paths: string[] = [];
  const later: string[] = [];
  const git: GitLoss[] = [];
  const vars = new Map<string, string>();
  let at: string | undefined = cwd;
  let seen = false;
  const place = (text: string | undefined) =>
    text === undefined || at === undefined ? undefined : path.resolve(at, text);
  for (const words of segments(code)) {
    const [first, ...rest] = words;
    if (!first) continue;
    if (words.every((w) => /^[A-Za-z_]\w*=/.test(w.text) && !w.redirect)) {
      for (const w of words) {
        const [name = "", ...value] = w.text.split("=");
        if (w.unknown || w.brace || w.tilde) vars.delete(name);
        else vars.set(name, value.join("="));
      }
      continue;
    }
    const program = path.basename(first.text);
    if (program === "cd") {
      const to = rest.find((w) => !w.text.startsWith("-") && !w.redirect);
      const text = to ? expand(to, vars) : undefined;
      at = at === undefined || text === undefined || text === "-" ? undefined : path.resolve(at, text);
      continue;
    }
    const known = words.map((w) => expand(w, vars));
    const lost = gitLoss(known.map((k, i) => k ?? words[i]?.text ?? ""));
    if (lost.length) {
      seen = true;
      git.push(...gitTargets(lost, gitFolder(known, at), look));
    }
    const line = words.map((w) => w.text).join(" ");
    if (!FORCED_RM.test(line)) continue;
    seen = true;
    if (program !== "rm") {
      later.push(line);
      continue;
    }
    let options = true;
    for (const w of rest) {
      if (w.redirect) continue;
      if (options && w.text === "--") options = false;
      else if (!(options && w.text.startsWith("-"))) {
        const where = place(expand(w, vars));
        if (where === undefined) later.push(w.text);
        else paths.push(where);
      }
    }
  }
  // A deletion no simple command here holds: inside a script a shell is fed.
  if (!seen) {
    const lines = unwrapped(code).split("\n");
    later.push(lines.find(detectsDeletion)?.trim() ?? shellCode(command.trim()));
  }
  return { paths, later, git };
}

/**
 * One git command's losses with their paths resolved where git runs (`gitAt`, undefined when only the shell knows).
 * A restore's paths become the files git says hold edits; when git cannot say, every path it names.
 */
function gitTargets(lost: Found[], gitAt: string | undefined, look: Overwritten): GitLoss[] {
  const restored = lost.filter((l) => l.restore);
  const edited =
    restored.length && gitAt !== undefined
      ? look(
          gitAt,
          restored.map((l) => l.target),
          restored.some((l) => l.restore === "both"),
        )
      : undefined;
  const out: GitLoss[] = (edited ?? []).map((target) => ({ what: "changes", target }));
  for (const { restore, ...l } of lost) {
    if (restore && edited) continue;
    // Paths and folders show in full; branch and stash names as they are.
    const name = l.what === "branch" || l.what === "stash" || l.what === "stashes" || l.what === "commits";
    out.push(name || gitAt === undefined ? l : { ...l, target: path.resolve(gitAt, l.target) });
  }
  return out;
}

/** Git's own options before its command: `-C dir`, `-c key=value`, `--git-dir …`. */
const GIT_VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

/** The folder a git command works in: `at`, moved by each `-C`; undefined when only the shell knows one. */
function gitFolder(words: Array<string | undefined>, at: string | undefined): string | undefined {
  let i = words.findIndex((w) => w === undefined || !/^[A-Za-z_]\w*=/.test(w));
  for (i++; i > 0 && i < words.length && (words[i] ?? "").startsWith("-"); i++) {
    const option = words[i] ?? "";
    if (!GIT_VALUED.has(option)) continue;
    i++;
    if (option !== "-C") continue;
    const to = words[i];
    at = at === undefined || to === undefined ? undefined : path.resolve(at, to);
  }
  return at;
}

/** Whether short flags (`-fd`) or long ones name a flag. */
const has = (args: string[], short: string, ...long: string[]) =>
  args.some((a) => long.includes(a) || (/^-[A-Za-z]+$/.test(a) && a.includes(short)));
const operands = (args: string[]) => {
  const dash = args.indexOf("--");
  return [
    ...args.slice(0, dash < 0 ? args.length : dash).filter((a) => !a.startsWith("-")),
    ...(dash < 0 ? [] : args.slice(dash + 1)),
  ];
};

/**
 * What one simple command throws away when it is a git command that discards work git would otherwise keep:
 * `worktree remove --force`, `branch -D`, `clean` (not a dry run), `reset --hard`, `checkout -- paths`/`checkout .`/
 * `checkout -f`, `restore` of the working tree, `switch --discard-changes`/`-f`, `stash drop`/`clear`, `rm -f`,
 * `reflog expire`/`delete` and `gc --prune=now`. Plain `worktree remove` and `branch -d` are `soft`: git refuses them
 * when work would be lost. A restore's paths say what it restores, for git to tell which hold edits.
 */
function gitLoss(words: string[]): Found[] {
  let i = words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w));
  if (i < 0 || path.basename(words[i] ?? "") !== "git") return [];
  for (i++; i < words.length && (words[i] ?? "").startsWith("-"); i++) if (GIT_VALUED.has(words[i] ?? "")) i++;
  const sub = words[i];
  const args = words.slice(i + 1);
  const ops = operands(args);
  const each = (what: GitLoss["what"], list: string[], fallback: string, more: Partial<Found> = {}): Found[] =>
    (list.length ? list : [fallback]).map((target) => ({ what, target, ...more }));
  const soft = { soft: true } as const;
  switch (sub) {
    case "worktree":
      if (ops[0] !== "remove") return [];
      return each("worktree", ops.slice(1), ".", has(args, "f", "--force") ? {} : soft);
    case "branch": {
      const force = has(args, "D") || (has(args, "d", "--delete") && has(args, "f", "--force"));
      if (force) return each("branch", ops, "?");
      return has(args, "d", "--delete") ? each("branch", ops, "?", soft) : [];
    }
    case "clean":
      return has(args, "n", "--dry-run") ? [] : each("untracked", ops, ".");
    case "reset":
      return args.includes("--hard") ? [{ what: "changes", target: "." }] : [];
    case "checkout": {
      const dash = args.indexOf("--");
      const paths = dash < 0 ? ops.filter((o) => o === "." || o === "./") : args.slice(dash + 1);
      if (has(args, "f", "--force")) return each("changes", paths, ".");
      // `checkout -- paths` restores from the index; `checkout <commit> -- paths` the index as well.
      const from = dash < 0 ? [] : operands(args.slice(0, dash));
      return paths.length ? each("changes", paths, ".", { restore: from.length ? "both" : "worktree" }) : [];
    }
    case "restore": {
      const valued = args.flatMap((a, k) => (a === "--source" || a === "-s" ? [args[k + 1] ?? ""] : []));
      const index = has(args, "S", "--staged");
      if (index && !has(args, "W", "--worktree")) return [];
      return each(
        "changes",
        ops.filter((o) => !valued.includes(o)),
        ".",
        { restore: index ? "both" : "worktree" },
      );
    }
    case "switch":
      return args.includes("--discard-changes") || has(args, "f", "--force") ? [{ what: "changes", target: "." }] : [];
    case "stash":
      if (ops[0] === "clear") return [{ what: "stashes", target: "" }];
      return ops[0] === "drop" ? [{ what: "stash", target: ops[1] ?? "stash@{0}" }] : [];
    case "rm":
      return has(args, "f", "--force") && !args.includes("--cached") ? each("changes", ops, ".") : [];
    case "reflog":
      return ops[0] === "expire" || ops[0] === "delete" ? [{ what: "commits", target: "" }] : [];
    case "gc":
      return args.some((a) => /^--prune=(now|all)$/.test(a)) ? [{ what: "commits", target: "" }] : [];
    default:
      return [];
  }
}

/** A word with the line's own variables put in, or undefined when only the shell knows it. */
function expand(w: Word, vars: Map<string, string>): string | undefined {
  if (w.brace || w.dropped || w.data) return undefined;
  let unknown = false;
  const text = w.text.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a: string | undefined, b: string | undefined) => {
    const v = vars.get(a ?? b ?? "");
    if (v === undefined) unknown = true;
    return v ?? "";
  });
  if (unknown || /[$`]/.test(text) || !text) return undefined;
  return w.tilde ? expandHome(text) : text;
}
