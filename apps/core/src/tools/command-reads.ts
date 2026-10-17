// Whether a shell command line only reads, on this machine: every program in it a known local reader, nothing written
// anywhere and nothing sent out. Such a call is risk `read` and never waits for the owner (DECISIONS.md#d-098).
import os from "node:os";
import { namedPaths, segments, type Word } from "./command-paths.ts";
import { gitReads } from "./git-reads.ts";

/** Programs that read files or print what they are given and write nothing but where they are redirected. */
const READERS = new Set(
  (
    "ls pwd cat head tail wc stat du df tree diff cmp comm sort uniq cut tr nl tac rev seq basename dirname realpath " +
    "readlink which whoami uname echo printf true false test [ column fold paste join expand md5 md5sum shasum " +
    "sha1sum sha256sum strings od hexdump jq grep egrep fgrep zgrep rg ag sleep date file cd pushd popd"
  ).split(" "),
);
/** Options that make a reader run another program or change something. */
const RUNS: Record<string, RegExp> = {
  rg: /^--(pre|hostname-bin)(=|$)/,
  ag: /^--pager(=|$)/,
  sort: /^--compress-program(=|$)/,
  file: /^(-C|--compile)$/,
  date: /^(-s|--set)(=|$)/,
};
/** Where output may go: it lands nowhere on disk. */
const SINK = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/;

/** A command line every part of which only reads here, and which writes nowhere. */
export function readsOnly(command: string, home = os.homedir()): boolean {
  const segs = segments(command);
  if (!segs.length || !segs.every(reader)) return false;
  // Nothing written (a redirection into a file, an output option) and no word whose place only the shell knows.
  return namedPaths(command, home).every(
    (n) => n.kind === "cd" || (n.kind === "path" && (!n.write || SINK.test(n.to.path))),
  );
}

/** One simple command: a known reader with arguments that neither write nor run anything else. */
function reader(words: Word[]): boolean {
  const [first, ...args] = words.filter((w) => !w.redirect && !w.data);
  if (!first) return true;
  // An assignment (`PAGER=…`), a program by path or by expansion could be anything.
  if (first.prose || first.unknown || first.brace || /[=/]/.test(first.text)) return false;
  const program = first.text;
  const flag = (re: RegExp) => args.some((a) => !a.prose && re.test(a.text));
  switch (program) {
    case "git":
      return gitReads(args);
    case "find":
      return findReads(args);
    case "sed": {
      if (flag(/^(-[a-zA-Z]*[if]|--in-place|--file)/)) return false;
      const scripts = args.filter((_a, i) => args[i - 1]?.text === "-e" || args[i - 1]?.text === "--expression");
      const script = scripts.length ? scripts : args.filter((a) => a.prose || !a.text.startsWith("-")).slice(0, 1);
      return script.every((s) => sedReads(s.text));
    }
    case "awk":
    case "gawk": {
      if (flag(/^(-f|-i|--inplace|--file|--include)/)) return false;
      const prog = args.find((a) => a.prose || !a.text.startsWith("-"))?.text ?? "";
      // Printing into a file, a pipe to a command, system() and getline (a file the folder rule never sees).
      return !/\bprintf?\b[^;{}]*>|(^|[^|])\|([^|]|$)|\bsystem\b|\bgetline\b|@/.test(prog);
    }
  }
  return READERS.has(program) && !(RUNS[program] && flag(RUNS[program]));
}

/** find that only lists: no -delete, no file it prints into, and -exec only of a reader. */
function findReads(args: Word[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const t = args[i]?.text ?? "";
    if (/^-(delete|fprint0?|fprintf|fls|ok|okdir)$/.test(t)) return false;
    if (t === "-exec" || t === "-execdir") {
      const sub: Word[] = [];
      for (i++; i < args.length && args[i]?.text !== ";" && args[i]?.text !== "+"; i++)
        if (args[i]?.text !== "{}") sub.push(args[i] as Word);
      if (!reader(sub)) return false;
    }
  }
  return true;
}

/** A sed script that neither writes a file (`w`, `W`, `s///w`) nor runs a command (`e`, `s///e`), nor reads one. */
export function sedReads(s: string): boolean {
  let i = 0;
  // From a delimiter, past its closing one.
  const delimited = () => {
    const d = s[i++];
    while (i < s.length && s[i] !== d) i += s[i] === "\\" ? 2 : 1;
    i++;
  };
  const address = () => {
    if (s[i] === "/") delimited();
    else if (s[i] === "\\") {
      i++;
      delimited();
    } else while (i < s.length && /[\d$~+]/.test(s[i] as string)) i++;
  };
  while (i < s.length) {
    while (i < s.length && /[\s;{}!]/.test(s[i] as string)) i++;
    if (i >= s.length) return true;
    address();
    if (s[i] === ",") {
      i++;
      address();
    }
    while (i < s.length && /[\s!{]/.test(s[i] as string)) i++;
    const c = s[i++];
    if (c === undefined || c === "}") continue;
    if (c === "s" || c === "y") {
      const d = s[i];
      if (!d || /[\s\\]/.test(d)) return false;
      delimited();
      i--;
      delimited();
      const flags = /^[a-zA-Z0-9]*/.exec(s.slice(i))?.[0] ?? "";
      if (c === "s" && /[weW]/.test(flags)) return false;
      i += flags.length;
    } else if ("aic".includes(c)) {
      const nl = s.indexOf("\n", i);
      if (nl < 0) return true;
      i = nl;
    } else if (":btT".includes(c)) {
      while (i < s.length && !/[;\n]/.test(s[i] as string)) i++;
    } else if ("qQlL".includes(c)) {
      while (i < s.length && /[\s\d]/.test(s[i] as string) && s[i] !== "\n") i++;
    } else if (!"pPdDnNgGhHxz=F".includes(c)) return false;
  }
  return true;
}
