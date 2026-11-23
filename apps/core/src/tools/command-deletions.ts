// What a command line's forced deletions remove, for the owner's card (DECISIONS.md#d-264): a static reading, as the
// destructive rule's, following the line's own `cd`s and variables.
import path from "node:path";
import { expandHome } from "../paths.ts";
import { shellCode } from "./command-heredocs.ts";
import { segments, type Word } from "./command-paths.ts";

/** A forced or recursive deletion. */
export const FORCED_RM = /\brm\b[^|;&]*\s(-\w*[rf]|--recursive|--force)/;

/**
 * The paths a command's forced deletions remove, resolved from `cwd`; `later` holds what only the running command
 * knows (a variable it did not set, `$(…)`, `xargs rm`, `find -exec rm`, a script fed to a shell), as written.
 */
export type Deletion = { paths: string[]; later: string[] };

export function deletionTargets(command: string, cwd: string): Deletion {
  const code = shellCode(command.trim());
  const paths: string[] = [];
  const later: string[] = [];
  const vars = new Map<string, string>();
  let at: string | undefined = cwd;
  let seen = false;
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
        const text = expand(w, vars);
        if (text === undefined || at === undefined) later.push(w.text);
        else paths.push(path.resolve(at, text));
      }
    }
  }
  // A deletion the pattern sees but no simple command holds: inside a script a shell is fed.
  if (!seen && FORCED_RM.test(code))
    later.push(
      code
        .split("\n")
        .find((l) => FORCED_RM.test(l))
        ?.trim() ?? code,
    );
  return { paths, later };
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
