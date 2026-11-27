// What a command line deletes, for the owner's card (DECISIONS.md#d-266): forced `rm`s and the git commands that throw
// away work git would otherwise keep. A static reading, as the destructive rule's, following the line's `cd`s and
// variables.
import path from "node:path";
import { expandHome } from "../paths.ts";
import { shellCode } from "./command-heredocs.ts";
import { segments, type Word } from "./command-paths.ts";
import { normalize, withoutSearchPattern } from "./command-text.ts";

/** A forced or recursive deletion; `git rm` is git's own, judged by gitLoss. */
const FORCED_RM = /(?<!\bgit(?:[ \t]+[^\s;&|]+)*[ \t]+)\brm\b[^|;&]*\s(-\w*[rf]|--recursive|--force)/;
const forcedRm = (code: string) => FORCED_RM.test(code) || FORCED_RM.test(normalize(code));

/** What a git command throws away, as the owner reads it on the card. */
export type GitLoss = {
  what: "branch" | "worktree" | "untracked" | "changes" | "stash" | "stashes" | "commits";
  target: string;
};

/**
 * The paths a command's deletions remove, resolved from `cwd`; `later` holds what only the running command knows (a
 * variable it did not set, `$(…)`, `xargs rm`, `find -exec rm`, a script fed to a shell), as written; `git` what its
 * git commands throw away.
 */
export type Deletion = { paths: string[]; later: string[]; git: GitLoss[] };

/** Text a shell is fed through a heredoc, read as the commands it is: the operator dropped, the body kept. */
const unwrapped = (code: string) => code.replace(/(?<!<)<<-?\s*(['"]?)([\w.-]+)\1/g, "");

const detectsDeletion = (code: string): boolean =>
  forcedRm(code) || segments(unwrapped(code)).some((s) => gitLoss(s.map((w) => w.text)).length > 0);
const deletionCode = (command: string) => withoutSearchPattern(shellCode(command.trim()), detectsDeletion);

/** Whether a command deletes: a forced `rm`, or a git command that discards work, a script fed to a shell included. */
export const deletes = (command: string): boolean => detectsDeletion(deletionCode(command));

export function deletionTargets(command: string, cwd: string): Deletion {
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
    const lost = gitLoss(words.map((w) => expand(w, vars) ?? w.text));
    for (const l of lost) {
      seen = true;
      // Paths and folders show in full where the command runs; branch and stash names as they are.
      const full = l.what === "branch" || l.what === "stash" || l.what === "stashes" || l.what === "commits";
      git.push(full ? l : { ...l, target: place(l.target) ?? l.target });
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

/** Git's own options before its command: `-C dir`, `-c key=value`, `--git-dir …`. */
const GIT_VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

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
 * `reflog expire`/`delete` and `gc --prune=now`. Plain `worktree remove` and `branch -d` are not: git refuses them
 * when work would be lost.
 */
function gitLoss(words: string[]): GitLoss[] {
  let i = words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w));
  if (i < 0 || path.basename(words[i] ?? "") !== "git") return [];
  for (i++; i < words.length && (words[i] ?? "").startsWith("-"); i++) if (GIT_VALUED.has(words[i] ?? "")) i++;
  const sub = words[i];
  const args = words.slice(i + 1);
  const ops = operands(args);
  const each = (what: GitLoss["what"], list: string[], fallback: string): GitLoss[] =>
    (list.length ? list : [fallback]).map((target) => ({ what, target }));
  switch (sub) {
    case "worktree":
      return ops[0] === "remove" && has(args, "f", "--force") ? each("worktree", ops.slice(1), ".") : [];
    case "branch": {
      const force = has(args, "D") || (has(args, "d", "--delete") && has(args, "f", "--force"));
      return force ? each("branch", ops, "?") : [];
    }
    case "clean":
      return has(args, "n", "--dry-run") ? [] : each("untracked", ops, ".");
    case "reset":
      return args.includes("--hard") ? [{ what: "changes", target: "." }] : [];
    case "checkout": {
      const dash = args.indexOf("--");
      const paths = dash < 0 ? ops.filter((o) => o === "." || o === "./") : args.slice(dash + 1);
      if (has(args, "f", "--force")) return each("changes", paths, ".");
      return paths.length ? each("changes", paths, ".") : [];
    }
    case "restore": {
      const valued = args.flatMap((a, k) => (a === "--source" || a === "-s" ? [args[k + 1] ?? ""] : []));
      const staged = has(args, "S", "--staged") && !has(args, "W", "--worktree");
      return staged
        ? []
        : each(
            "changes",
            ops.filter((o) => !valued.includes(o)),
            ".",
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
