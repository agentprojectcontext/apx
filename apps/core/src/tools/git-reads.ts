// Which git commands only read the repository: no change to it, nothing sent over the network.
import type { Word } from "./command-paths.ts";

/** git's subcommands that only read the repository (no network, no change), and the list forms of a few others. */
const GIT_READS = new Set(
  (
    "status log show diff ls-tree ls-files rev-parse describe blame grep shortlog rev-list cat-file merge-base " +
    "name-rev for-each-ref show-ref count-objects whatchanged var version"
  ).split(" "),
);
/** git's own options before the subcommand that change nothing (`-c` could set a program to run, so it is not one). */
const GIT_TOP =
  /^(--no-pager|-P|--no-optional-locks|--literal-pathspecs|--no-replace-objects|--bare|--(git-dir|work-tree)=.+)$/;

/** A git command line's arguments (after `git`) that only read: git's own safe options, then a reading subcommand. */
export function gitReads(args: Word[]): boolean {
  let i = 0;
  for (; i < args.length; i++) {
    const t = args[i]?.text ?? "";
    if (t === "-C" || t === "--git-dir" || t === "--work-tree") i++;
    else if (t.startsWith("-")) {
      if (!GIT_TOP.test(t)) return false;
    } else break;
  }
  const sub = args[i]?.text ?? "";
  const rest = args.slice(i + 1);
  // grep's -O opens a program; --output writes a file.
  if (rest.some((a) => !a.prose && /^(-O|--open-files-in-pager|--output)/.test(a.text))) return false;
  return GIT_READS.has(sub) || gitLists(sub, rest);
}

/** Subcommands that change things unless given only a listing's words (`git branch -avv`, `git config --get x`). */
export function gitLists(sub: string, rest: Word[]): boolean {
  const first = rest[0]?.text;
  switch (sub) {
    case "branch":
      return listing(
        rest,
        /^-[arvli]+$/,
        /^--(list|all|remotes|verbose|show-current|ignore-case|no-color|color(=.*)?|sort=.*|format=.*|column|no-column)$/,
        "l",
      );
    case "tag":
      return listing(rest, /^-(l|n\d*|i)$/, /^--(list|ignore-case|sort=.*|format=.*|column|no-column)$/, "l");
    case "worktree":
      return first === "list";
    case "stash":
      return first === "list" || first === "show";
    case "remote":
      return first === "get-url" || rest.every((a) => /^(-v|--verbose)$/.test(a.text));
    case "config": {
      const flags = rest.filter((a) => a.text.startsWith("-")).map((a) => a.text);
      const known =
        /^(--get|--get-all|--get-regexp|--list|-l|--show-origin|--show-scope|--local|--global|--system|--name-only|--null|-z|--includes)$/;
      return (
        flags.some((f) => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(f)) && flags.every((f) => known.test(f))
      );
    }
  }
  return false;
}

/** Valued options that only narrow a listing (`--contains <commit>`). */
const NARROWS = /^--(contains|no-contains|merged|no-merged|points-at)$/;

/** `git branch`/`git tag` as a listing: known options, and patterns only when a list option is given. */
function listing(rest: Word[], short: RegExp, long: RegExp, list: string): boolean {
  const listed = rest.some((a) => a.text === "--list" || (short.test(a.text) && a.text.slice(1).includes(list)));
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]?.text ?? "";
    if (NARROWS.test(t)) i += rest[i + 1] && !rest[i + 1]?.text.startsWith("-") ? 1 : 0;
    else if (/^--(contains|no-contains|merged|no-merged|points-at)=/.test(t)) continue;
    else if (t.startsWith("-")) {
      if (!short.test(t) && !long.test(t)) return false;
    } else if (!listed) return false;
  }
  return true;
}
