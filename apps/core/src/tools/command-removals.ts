// Two readings the destructive-command rule needs before it judges a line (DECISIONS.md#d-264): which text is shell
// code, and whether every forced deletion stays below the folder the command works in.
import os from "node:os";
import path from "node:path";
import { isInside, samePath } from "../paths.ts";
import { segments, type Word } from "./command-paths.ts";

/** Programs that run the text they are fed as commands: a heredoc for them is shell code, not data. */
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "ash",
  "csh",
  "tcsh",
  "ssh",
  "su",
  "sudo",
  "doas",
  "eval",
  "source",
  ".",
  "exec",
  "osascript",
]);

const namesShell = (line: string) =>
  line
    .replace(/["']/g, "")
    .split(/[\s;&|()`]+/)
    .some((w) => SHELLS.has(path.basename(w)));

/**
 * The command with each heredoc's body left out unless a shell reads it (`bash <<EOF`, `cat <<EOF | sh`): a Python
 * script or a JSON file written through a heredoc is data for its program, as a script file's lines are, not words
 * the shell runs. Its terminator line stays, so the line still parses. `toShell`: some body was kept for a shell.
 */
export function shellCode(c: string): { code: string; toShell: boolean } {
  let out = "";
  let lineAt = 0;
  let toShell = false;
  const tags: string[] = [];
  for (let i = 0; i < c.length; i++) {
    const ch = c[i] as string;
    if (ch === "\\") {
      out += ch + (c[i + 1] ?? "");
      i++;
    } else if (ch === "'") {
      const stop = c.indexOf("'", i + 1);
      const end = stop < 0 ? c.length : stop + 1;
      out += c.slice(i, end);
      i = end - 1;
    } else if (ch === '"') {
      let stop = i + 1;
      while (stop < c.length && c[stop] !== '"') stop += c[stop] === "\\" ? 2 : 1;
      out += c.slice(i, stop + 1);
      i = stop;
    } else if (ch === "#" && (i === 0 || /\s/.test(c[i - 1] ?? ""))) {
      const nl = c.indexOf("\n", i);
      const end = nl < 0 ? c.length : nl;
      out += c.slice(i, end);
      i = end - 1;
    } else if (ch === "<" && c[i + 1] === "<" && c[i + 2] !== "<") {
      const m = /^<<-?\s*(['"]?)([\w.-]+)\1/.exec(c.slice(i));
      if (m?.[2]) tags.push(m[2]);
      const taken = m?.[0] ?? "<<";
      out += taken;
      i += taken.length - 1;
    } else if (ch === "\n" && tags.length) {
      const feeds = namesShell(out.slice(lineAt));
      if (feeds) toShell = true;
      let at = i;
      for (const tag of tags.splice(0)) {
        out += "\n";
        const lines = c.slice(at + 1).split("\n");
        const stop = lines.findIndex((l) => l.trim() === tag);
        const text = (stop < 0 ? lines : lines.slice(0, stop + 1)).join("\n");
        out += feeds ? text : stop < 0 ? "" : (lines[stop] ?? "");
        at += 1 + text.length;
      }
      i = at - 1;
      lineAt = out.length;
    } else {
      out += ch;
      if (ch === "\n") lineAt = out.length;
    }
  }
  return { code: out, toShell };
}

/** A forced or recursive deletion, as the destructive rule reads it. */
export const FORCED_RM = /\brm\b[^|;&]*\s(-\w*[rf]|--recursive|--force)/;

/** Folders that hold whole disks, home folders or the system: no deletion below them counts as the agent's own work. */
const MOUNTS = ["/Volumes", "/Users", "/home", "/mnt", "/media", "/run/media"];
const SYSTEM = ["/tmp", "/private/tmp", "/var", "/private/var", "/opt", "/usr", "/etc"];
const wide = (dir: string, home: string) =>
  samePath(dir, home) ||
  samePath(dir, path.dirname(home)) ||
  SYSTEM.some((w) => samePath(dir, w)) ||
  MOUNTS.some((w) => samePath(dir, w) || samePath(path.dirname(dir), w)) ||
  path.parse(path.resolve(dir)).root === path.resolve(dir);

/**
 * Whether every `rm -r`/`rm -f` in `code` (heredoc data already left out) deletes only paths strictly below the
 * folder the line starts in: `folder` when known (absolute), else relative paths that never climb out of it. Variables
 * the line itself set (`D=out/x; rm -rf $D/tmp`) and its `cd`s are followed; anything only the shell can place (`$(…)`,
 * `~`, braces, a variable it did not set), the folder itself, a bare wildcard, `.git` or a deletion run by another
 * program (`xargs rm`, `find -exec rm`, `bash -c`) is not confined.
 */
export function confinedRemovals(code: string, folder?: string, home = os.homedir()): boolean {
  if (folder !== undefined && (!path.isAbsolute(folder) || wide(folder, home))) return false;
  const vars = new Map<string, string>();
  // Where the line is: absolute when the folder is known, else relative to its start ("." until a `cd`).
  let at: string | undefined = folder ?? ".";
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
      at = at === undefined || text === undefined ? undefined : moved(at, text);
      continue;
    }
    const line = words.map((w) => w.text).join(" ");
    if (!FORCED_RM.test(line)) continue;
    if (program !== "rm" || at === undefined) return false;
    let options = true;
    const targets: Word[] = [];
    for (const w of rest) {
      if (w.redirect) continue;
      if (options && w.text === "--") options = false;
      else if (!(options && w.text.startsWith("-"))) targets.push(w);
    }
    if (!targets.length) return false;
    for (const w of targets) {
      const text = expand(w, vars);
      if (text === undefined || !below(at, text, folder)) return false;
    }
  }
  return true;
}

/** A word with the line's own variables put in, or undefined when only the shell knows it. */
function expand(w: Word, vars: Map<string, string>): string | undefined {
  if (w.brace || w.tilde || w.dropped || w.data) return undefined;
  let unknown = false;
  const text = w.text.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a: string | undefined, b: string | undefined) => {
    const v = vars.get(a ?? b ?? "");
    if (v === undefined) unknown = true;
    return v ?? "";
  });
  return unknown || /[$`]/.test(text) || !text ? undefined : text;
}

/** Where a `cd` leads: an absolute folder, or a path relative to the line's start; undefined when unknown. */
function moved(at: string, to: string): string | undefined {
  if (to === "-") return undefined;
  if (path.isAbsolute(at)) return path.resolve(at, to);
  if (path.isAbsolute(to)) return to;
  return path.posix.normalize(path.posix.join(at, to));
}

/** Whether `target`, from `at`, is strictly below the start folder and names something there, not a bare wildcard. */
function below(at: string, target: string, folder: string | undefined): boolean {
  let rel: string;
  if (folder !== undefined) {
    const abs = path.resolve(at, target);
    if (!isInside(folder, abs) || samePath(folder, abs)) return false;
    rel = path.relative(folder, abs).split(path.sep).join("/");
  } else {
    if (path.isAbsolute(at) || path.isAbsolute(target)) return false;
    rel = path.posix.normalize(path.posix.join(at, target));
  }
  const parts = rel.split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts[0] === ".." || path.posix.isAbsolute(rel)) return false;
  if (parts.includes(".git")) return false;
  return /[^*?[\].]/.test(parts[0] ?? "");
}
