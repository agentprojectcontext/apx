// The paths a shell command line names, so the folder rule can judge them as file_read does. A static reading of the
// words, not a sandbox: a script that builds a path at run time is not seen.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A path the command names, or a `cd` (an empty path: to somewhere only known when it runs). */
export type Named = { path: string; cd: boolean };

/** Programs, libraries and devices a command names as plumbing (`/usr/bin/env`, `2>/dev/null`), never the owner's files. */
const PLUMBING = /^\/(dev|usr|bin|sbin|opt|System|nix)(\/|$)/;
const SEGMENT_END = new Set([";", "&", "|", "\n", "(", ")", "`"]);
const WORD_END = new Set([" ", "\t", "\r", "<", ">"]);

type Word = { text: string; prose: boolean; unknown: boolean };

/** The command's simple commands, each as its words: quotes resolved, heredoc bodies and comments left out. */
function segments(c: string): Word[][] {
  const out: Word[][] = [[]];
  let w: Word | undefined;
  const heredocs: string[] = [];
  const end = () => {
    if (w) out.at(-1)?.push(w);
    w = undefined;
  };
  const word = () => {
    w ??= { text: "", prose: false, unknown: false };
    return w;
  };
  for (let i = 0; i < c.length; i++) {
    const ch = c[i] as string;
    if (ch === "\\") {
      word().text += c[++i] ?? "";
    } else if (ch === "'" || ch === '"') {
      const close = c.indexOf(ch, i + 1);
      const inner = c.slice(i + 1, close < 0 ? c.length : close);
      const it = word();
      it.text += inner;
      if (/\s/.test(inner)) it.prose = true;
      if (ch === '"' && inner.includes("$")) it.unknown = true;
      i = close < 0 ? c.length : close;
    } else if (ch === "<" && c[i + 1] === "<" && c[i + 2] !== "<") {
      end();
      const m = /^<<-?\s*['"]?([\w.-]+)['"]?/.exec(c.slice(i));
      if (m?.[1]) heredocs.push(m[1]);
      i += (m?.[0].length ?? 2) - 1;
    } else if (ch === "\n" && heredocs.length) {
      end();
      for (const tag of heredocs.splice(0)) {
        const lines = c.slice(i + 1).split("\n");
        const stop = lines.findIndex((l) => l.trim() === tag);
        i += stop < 0 ? c.length : lines.slice(0, stop + 1).join("\n").length + 1;
      }
      out.push([]);
    } else if (ch === "#" && !w) {
      const nl = c.indexOf("\n", i);
      i = (nl < 0 ? c.length : nl) - 1;
    } else if (ch === "$" && c[i + 1] === "(") {
      end();
      out.push([]);
      i++;
    } else if (SEGMENT_END.has(ch)) {
      end();
      out.push([]);
    } else if (WORD_END.has(ch)) {
      end();
    } else {
      const it = word();
      if (ch === "$") it.unknown = true;
      it.text += ch;
    }
  }
  end();
  return out.filter((s) => s.length);
}

/** A word as the path it names, or undefined when it names none (an option, a URL, a pattern, a variable). */
function asPath(w: Word, home: string): string | undefined {
  // Quoted words with spaces are text (a message, a pattern, a script) unless they start like a path.
  if (w.prose && !/^(\/|~\/|\.\.(\/|$))/.test(w.text)) return undefined;
  let t = w.text;
  // --file=x, VAR=x and key=x name x.
  if (t.includes("=") && !/^[/.~]/.test(t)) t = t.slice(t.indexOf("=") + 1);
  else if (t.startsWith("-")) return undefined;
  t = t.replace(/^(\$HOME|\$\{HOME\})(?=\/|$)/, "~");
  if (w.unknown && t.includes("$")) return undefined;
  if (/^[a-z][\w+.-]*:\/\//i.test(t)) return undefined;
  // A glob names the folder before its first wildcard.
  const glob = t.search(/[*?[{]/);
  if (glob >= 0) t = t.slice(0, glob);
  if (!t) return undefined;
  if (t === "~" || t.startsWith("~/")) t = path.join(home, t.slice(1));
  if (path.isAbsolute(t)) {
    if (PLUMBING.test(path.normalize(t))) return undefined;
    // "/api/users" in a grep is a route, not a file: only an absolute path whose top folder exists is one.
    const top = t.split("/")[1];
    if (top && !fs.existsSync(`/${top}`)) return undefined;
  }
  return t;
}

/** Every path a command line names, in order, with its `cd`s (a bare `cd` goes home). */
export function namedPaths(command: string, home = os.homedir()): Named[] {
  const out: Named[] = [];
  for (const words of segments(command)) {
    const [first, ...rest] = words;
    if (first && (first.text === "cd" || first.text === "pushd") && !first.prose) {
      // `cd -` and `cd $X` go where only the shell knows.
      const to = rest.find((w) => w.text === "-" || !w.text.startsWith("-") || w.prose);
      const at = !to ? home : to.text === "-" ? undefined : asPath({ ...to, prose: false }, home);
      out.push({ path: at ?? "", cd: true });
      continue;
    }
    for (const w of words) {
      const p = asPath(w, home);
      if (p !== undefined) out.push({ path: p, cd: false });
    }
  }
  return out;
}
