// The paths a shell command line names and whether it reads or writes each, so the folder rule can judge them as it
// judges the file tools. A static reading of the words, not a sandbox: a script that builds a path as it runs
// (`python3 -c "open(...)"`) is not seen.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A path as written, from where the command runs (`old`: from the folder it was in before its last `cd`). */
export type Ref = { path: string; old?: boolean };

/**
 * What a command line does, in order: moves (`cd`, `to` undefined when only the shell knows where), reads or writes a
 * path, names a word whose place is only known when it runs (`$X`, `{a,b}`, `$(…)`), or may write in the folder it
 * runs in (`here`; `known` when the program surely writes there, like `git commit`).
 */
export type Named =
  | { kind: "cd"; to: Ref | undefined }
  | { kind: "path"; to: Ref; write: boolean }
  | { kind: "unknown"; text: string; write: boolean }
  | { kind: "here"; known: boolean };

type Word = {
  text: string;
  /** Quoted text with spaces: a message or a pattern, not a path unless it starts like one. */
  prose: boolean;
  /** Holds an expansion: `$X`, `$(…)` or a backtick. */
  unknown: boolean;
  /** An unquoted `{`: brace expansion. */
  brace: boolean;
  /** Starts with an unquoted `~`. */
  tilde: boolean;
  redirect?: "read" | "write";
  /** Not a path at all (a here-string). */
  data?: boolean;
};

const blank = (): Word => ({ text: "", prose: false, unknown: false, brace: false, tilde: false });

/** The text of each `$(…)` and backtick inside double-quoted text, which the shell runs too. */
function substitutions(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      out.push(s.slice(i + 1, end < 0 ? s.length : end));
      i = end < 0 ? s.length : end;
    } else if (s[i] === "$" && s[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      for (; j < s.length && depth; j++) depth += s[j] === "(" ? 1 : s[j] === ")" ? -1 : 0;
      out.push(s.slice(i + 2, j - 1));
      i = j - 1;
    }
  }
  return out;
}

/**
 * The command's simple commands, each as its words: quotes resolved, redirections marked, heredoc bodies and comments
 * left out. A command substitution's commands come before the command that uses them, as the shell runs them.
 */
function segments(c: string): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  let w: Word | undefined;
  let pending: "read" | "write" | "fd" | "data" | undefined;
  const stack: Array<{ seg: Word[]; w: Word | undefined; close: string; pending: typeof pending; parens: number }> = [];
  const heredocs: string[] = [];
  const end = () => {
    if (w) {
      if (pending === "fd" && /^(\d+|-)$/.test(w.text)) w = undefined;
      else if (pending === "data") w.data = true;
      else if (pending === "fd") w.redirect = "write";
      else if (pending) w.redirect = pending;
      if (w) cur.push(w);
      pending = undefined;
    }
    w = undefined;
  };
  const close = () => {
    end();
    pending = undefined;
    if (cur.length) out.push(cur);
    cur = [];
  };
  const pop = () => {
    close();
    const top = stack.pop();
    cur = top?.seg ?? [];
    w = top?.w;
    pending = top?.pending;
  };
  const word = () => {
    w ??= blank();
    return w;
  };
  const open = (closer: string, placeholder: boolean) => {
    if (placeholder) {
      const it = word();
      it.unknown = true;
      it.text += "$(";
    } else end();
    stack.push({ seg: cur, w, close: closer, pending, parens: 0 });
    cur = [];
    w = undefined;
    pending = undefined;
  };
  for (let i = 0; i < c.length; i++) {
    const ch = c[i] as string;
    const next = c[i + 1];
    if (ch === "\\") {
      if (next !== "\n") word().text += next ?? "";
      i++;
    } else if (ch === "'") {
      const stop = c.indexOf("'", i + 1);
      const inner = c.slice(i + 1, stop < 0 ? c.length : stop);
      const it = word();
      it.text += inner;
      if (/\s/.test(inner)) it.prose = true;
      i = stop < 0 ? c.length : stop;
    } else if (ch === '"') {
      let stop = i + 1;
      while (stop < c.length && c[stop] !== '"') stop += c[stop] === "\\" ? 2 : 1;
      const inner = c.slice(i + 1, stop).replace(/\\(.)/g, "$1");
      const it = word();
      it.text += inner;
      if (/\s/.test(inner)) it.prose = true;
      if (/[$`]/.test(inner)) it.unknown = true;
      for (const sub of substitutions(inner)) out.push(...segments(sub));
      i = stop;
    } else if (ch === "<" && next === "<" && c[i + 2] === "<") {
      end();
      pending = "data";
      i += 2;
    } else if (ch === "<" && next === "<") {
      end();
      const m = /^<<-?\s*['"]?([\w.-]+)['"]?/.exec(c.slice(i));
      if (m?.[1]) heredocs.push(m[1]);
      i += (m?.[0].length ?? 2) - 1;
    } else if (ch === "\n" && heredocs.length) {
      close();
      for (const tag of heredocs.splice(0)) {
        const lines = c.slice(i + 1).split("\n");
        const stop = lines.findIndex((l) => l.trim() === tag);
        i += stop < 0 ? c.length : lines.slice(0, stop + 1).join("\n").length + 1;
      }
    } else if (ch === "#" && !w) {
      const nl = c.indexOf("\n", i);
      i = (nl < 0 ? c.length : nl) - 1;
    } else if (ch === "$" && next === "(" && c[i + 2] === "(") {
      // Arithmetic: a number, never a path.
      const stop = c.indexOf("))", i);
      const it = word();
      it.unknown = true;
      it.text += "$((";
      i = stop < 0 ? c.length : stop + 1;
    } else if (ch === "$" && next === "(") {
      open(")", true);
      i++;
    } else if ((ch === "<" || ch === ">") && next === "(") {
      open(")", false);
      i++;
    } else if (ch === "`") {
      if (stack.at(-1)?.close === "`") pop();
      else open("`", true);
    } else if (ch === ")" && stack.at(-1)?.close === ")" && !stack.at(-1)?.parens) {
      pop();
    } else if (ch === ">" || ch === "<" || (ch === "&" && next === ">")) {
      // A redirection: `2>`'s fd is not a word; `>&2` and `2>&1` copy a stream; the next word is where it reads/writes.
      if (w && /^\d+$/.test(w.text) && !w.prose) w = undefined;
      end();
      let write = ch !== "<";
      if (ch === "&") i++;
      if (c[i + 1] === ">" || c[i + 1] === "|") {
        write = true;
        i++;
      }
      if (c[i + 1] === "&") {
        pending = "fd";
        i++;
      } else pending = write ? "write" : "read";
    } else if (ch === ";" || ch === "&" || ch === "|" || ch === "\n" || ch === "(" || ch === ")") {
      const top = stack.at(-1);
      if (top && ch === "(") top.parens++;
      if (top && ch === ")") top.parens--;
      close();
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      end();
    } else {
      const it = word();
      if (ch === "$") it.unknown = true;
      if (ch === "{" && !it.text.endsWith("$")) it.brace = true;
      if (ch === "~" && !it.text) it.tilde = true;
      it.text += ch;
    }
  }
  close();
  while (stack.length) pop();
  close();
  return out;
}

let user: string | undefined;
const userName = () => {
  try {
    user ??= os.userInfo().username;
  } catch {
    user = "";
  }
  return user;
};

/** A word as the path it names, "unknown" when only the shell knows it, undefined when it names none (an option, a URL). */
function toRef(w: Word, home: string): Ref | "unknown" | undefined {
  if (w.data) return undefined;
  // Quoted words with spaces are text (a message, a pattern, a script) unless they start like a path.
  if (w.prose && !/^(\/|~\/|\.\.(\/|$))/.test(w.text)) return undefined;
  let t = w.text;
  let tilde = w.tilde;
  // --file=x, VAR=x and key=x name x.
  if (t.includes("=") && !/^[/.~]/.test(t)) {
    t = t.slice(t.indexOf("=") + 1);
    tilde = t.startsWith("~");
  } else if (t.startsWith("-")) return undefined;
  let old = false;
  if (w.unknown) {
    const m = /^\$(?:(HOME|PWD|OLDPWD)|\{(HOME|PWD|OLDPWD)\})(?=\/|$)/.exec(t);
    const v = m?.[1] ?? m?.[2];
    if (m && v) {
      t = (v === "HOME" ? "~" : ".") + t.slice(m[0].length);
      tilde = v === "HOME";
      old = v === "OLDPWD";
    }
    if (t.includes("$")) return "unknown";
  }
  if (w.brace && !/^(\{\}|\{|\})$/.test(w.text)) return "unknown";
  if (/^[a-z][\w+.-]*:\/\//i.test(t)) return undefined;
  if (tilde && t.startsWith("~")) {
    const slash = t.indexOf("/");
    const name = t.slice(1, slash < 0 ? t.length : slash);
    const tail = slash < 0 ? "" : t.slice(slash);
    if (name === "" || name === userName()) t = home + tail;
    else if (name === "+") t = `.${tail}`;
    else if (name === "-") {
      t = `.${tail}`;
      old = true;
    } else if (/^[\w.-]+$/.test(name)) t = `${path.dirname(home)}/${name}${tail}`;
    else return "unknown";
  }
  // A glob names the folder before its first wildcard.
  const glob = t.search(/[*?[]/);
  if (glob >= 0) t = t.slice(0, glob);
  if (!t) return undefined;
  if (path.isAbsolute(t)) {
    // "/api/users" in a grep is a route, not a file: only an absolute path whose top folder exists is one.
    const top = t.split("/")[1];
    if (top && !fs.existsSync(`/${top}`)) return undefined;
  }
  return old ? { path: t, old } : { path: t };
}

/** Programs that write nothing but the paths they name (in their redirections, or as handled below). */
const READERS = new Set(
  (
    "ls pwd cat head tail wc grep egrep fgrep zgrep rg ag ack echo printf which whereis type date whoami id du df stat " +
    "file uname cut uniq tr nl jq yq less more tree find diff cmp comm sed awk gawk basename dirname realpath readlink " +
    "test [ [[ true false sleep xxd hexdump od strings md5 md5sum shasum sha1sum sha256sum column fold expand paste " +
    "join tac rev seq printenv hostname uptime ps pgrep lsof for while until if case select : export unset set local " +
    "read wait source . alias hash exit return shift break continue declare typeset let sort git cd pushd popd"
  ).split(" "),
);
/** Every path these name is one they change. */
const CHANGE_ALL = new Set(
  "touch mkdir rm rmdir unlink chmod chown chgrp truncate shred srm mkfifo mknod chflags tee mv".split(" "),
);
/** Their last path is where they write; the others are read. */
const COPIERS = new Set(["cp", "install", "ln", "rsync", "scp", "ditto"]);
/** Keywords that come before a command, and programs that run the command after them. */
const KEYWORDS = new Set(["then", "else", "elif", "do", "!", "{", "}", "time", "fi", "done", "esac", "function"]);
const WRAPPERS = new Set([
  "env",
  "nice",
  "nohup",
  "command",
  "builtin",
  "exec",
  "timeout",
  "stdbuf",
  "caffeinate",
  "sudo",
  "doas",
]);
const words = (s: string) => new Set(s.split(" "));
const GREP = words("-e -f -A -B -C -m -d -D -g -t -T -j -M --regexp --file --glob --max-count --context");
const AWK = words("-v -F -f");
const JQ = words("-f --from-file --indent -L");
const COPY = words("-t -S --target-directory");
/** Options whose value is the next word, per program (the value is not a path unless handled). */
const VALUED: Record<string, Set<string>> = {
  grep: GREP,
  egrep: GREP,
  fgrep: GREP,
  zgrep: GREP,
  rg: GREP,
  ag: GREP,
  ack: GREP,
  sed: words("-e -f -l --expression --file"),
  awk: AWK,
  gawk: AWK,
  jq: JQ,
  yq: JQ,
  cp: COPY,
  ln: COPY,
  mv: COPY,
  install: words("-m -o -g -t -S --target-directory"),
  rsync: words("-e -f -M -B --exclude --include --filter --rsh"),
  scp: words("-P -i -o -F -c -l -S -J"),
  touch: words("-r -d -t -A"),
  mkdir: words("-m"),
  truncate: words("-s -r"),
  tar: words("-f -C --file --directory -T -X --exclude"),
  curl: words("-o --output -T --upload-file -d --data -H -X -u -A -e -K -c -D -b -F -w -m --max-time"),
  wget: words("-O -P -o -a --output-document --directory-prefix"),
  unzip: words("-d -x"),
  xargs: words("-n -I -P -L -d -E -s -a"),
  timeout: words("-s -k --signal --kill-after"),
  nice: words("-n"),
  sudo: words("-u -g -C -h -p -U"),
  env: words("-u -C -S"),
  sort: words("-o -k -t -S -T --output"),
  tree: words("-o -L -I -P"),
};

const GIT_READS = new Set(
  (
    "status log diff show rev-parse ls-files blame grep describe shortlog cat-file ls-tree rev-list reflog merge-base " +
    "name-rev for-each-ref whatchanged count-objects show-ref var help version"
  ).split(" "),
);
/** `git branch`, `tag`, `stash`… only read with these words (listing). */
const GIT_LISTS: Record<string, RegExp> = {
  branch: /^(-a|-r|-v|-vv|-l|--list|--all|--remotes|--show-current|--verbose|--color.*|--no-color|--sort=.*)$/,
  tag: /^(-l|--list|-n\d*|--sort=.*|--contains|--points-at)$/,
  stash: /^(list|show|-p|--stat)$/,
  remote: /^(-v|--verbose|show|get-url)$/,
  config: /^(--get|--get-all|--list|-l|--show-origin|--global|--local|--system|--name-only|--get-regexp)$/,
  worktree: /^(list|--porcelain)$/,
};

/** The option and the positional words of a command's arguments: options (and their values) left out. */
function split(args: Word[], valued: Set<string> = new Set()) {
  const flags = new Map<string, Word | true>();
  const positional: Word[] = [];
  let rest = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as Word;
    if (rest || a.prose || !a.text.startsWith("-") || a.text === "-") positional.push(a);
    else if (a.text === "--") rest = true;
    else if (valued.has(a.text) && args[i + 1]) flags.set(a.text, args[++i] as Word);
    else flags.set(a.text.split("=")[0] as string, true);
  }
  return { flags, positional };
}

/** Whether a step writes a path, or surely writes where it runs. */
const writes = (n: Named) => (n.kind === "here" ? n.known : n.kind !== "cd" && n.write);

/** One program's arguments, and how to say what it does with each. */
type Call = {
  program: string;
  args: Word[];
  positional: Word[];
  out: Named[];
  home: string;
  depth: number;
  name: (w: Word, write: boolean) => void;
  /** An option's value (`-o x`, `--output=x`), by any of its names. */
  value: (...keys: string[]) => Word | undefined;
  has: (re: RegExp) => boolean;
  all: (write: boolean, list?: Word[]) => void;
  /** `--opt=path`, which names a path in any program. */
  optionPaths: () => void;
};

/** What one simple command does with paths. */
function classify(words: Word[], home: string, depth: number): Named[] {
  const out: Named[] = [];
  // Where a program writes is a path however it is quoted.
  const name = (w: Word, write: boolean) => {
    const r = toRef(write ? { ...w, prose: false } : w, home);
    if (r === "unknown") out.push({ kind: "unknown", text: w.text, write });
    else if (r) out.push({ kind: "path", to: r, write });
  };
  // Redirections first: their target is always read or written, whatever the program.
  const ws: Word[] = [];
  for (const w of words) {
    if (w.redirect) name(w, w.redirect === "write");
    else ws.push(w);
  }
  let i = 0;
  const skipAssignments = () => {
    while (i < ws.length && /^[A-Za-z_]\w*=/.test(ws[i]?.text ?? "") && !ws[i]?.prose) name(ws[i++] as Word, false);
  };
  skipAssignments();
  for (;;) {
    const word = ws[i]?.text ?? "";
    if (KEYWORDS.has(word)) i++;
    else if (WRAPPERS.has(path.basename(word))) {
      const valued = VALUED[path.basename(word)];
      i++;
      while (i < ws.length && (ws[i]?.text.startsWith("-") ?? false)) i += valued?.has(ws[i]?.text ?? "") ? 2 : 1;
      if (word === "timeout" && i < ws.length) i++;
      skipAssignments();
    } else break;
  }
  const programWord = ws[i];
  if (!programWord) return out;
  // Running a program reads it.
  if (programWord.text.includes("/")) name(programWord, false);
  const program = path.basename(programWord.text);
  const args = ws.slice(i + 1);
  const { flags, positional } = split(args, VALUED[program]);
  const c: Call = {
    program,
    args,
    positional,
    out,
    home,
    depth,
    name,
    value: (...keys) => {
      for (const k of keys) {
        const v = flags.get(k);
        if (v && v !== true) return v;
        const eq = args.find((a) => a.text.startsWith(`${k}=`));
        if (eq) return { ...eq, text: eq.text.slice(k.length + 1) };
      }
      return undefined;
    },
    has: (re) => args.some((a) => !a.prose && re.test(a.text)),
    all: (write, list = positional) => {
      for (const a of list) name(a, write);
    },
    optionPaths: () => {
      for (const a of args) if (a.text.startsWith("--") && a.text.includes("=") && !a.prose) name(a, false);
    },
  };
  if (fileTool(c) || textTool(c) || runner(c)) return out;
  c.all(false);
  c.optionPaths();
  // Any other program may write where it runs (`npm install`, `make`).
  if (!READERS.has(program)) out.push({ kind: "here", known: false });
  return out;
}

/** Programs that make, change or fetch files: true when the program is one. */
function fileTool(c: Call): boolean {
  const { program, positional, name, value, has, all, out } = c;
  if (CHANGE_ALL.has(program)) {
    // chmod's mode, chown's owner come first.
    const list = /^(chmod|chown|chgrp)$/.test(program) && !has(/^--reference/) ? positional.slice(1) : positional;
    all(true, list);
    const target = value("-t", "--target-directory");
    if (target) name(target, true);
    c.optionPaths();
    return true;
  }
  if (COPIERS.has(program)) {
    const target = value("-t", "--target-directory");
    const sources = target ? positional : positional.slice(0, -1);
    all(program === "rsync" && has(/^--remove-source-files$/), sources);
    if (target) name(target, true);
    else if (positional.length) name(positional.at(-1) as Word, true);
    return true;
  }
  switch (program) {
    case "dd":
      for (const a of c.args) {
        if (a.text.startsWith("of=")) name({ ...a, text: a.text.slice(3) }, true);
        if (a.text.startsWith("if=")) name({ ...a, text: a.text.slice(3) }, false);
      }
      return true;
    case "tar":
    case "bsdtar":
    case "gtar": {
      // The first word may be a bundle of letters with or without a dash (`xzf`, `-czf`); `f` takes the next word.
      const first = c.args[0]?.text ?? "";
      const bundle = /^-?[a-zA-Z]+$/.test(first) ? first.replace(/^-/, "") : "";
      const files = first.startsWith("-") ? positional : positional.slice(1);
      const extract = /x/.test(bundle) || has(/^--(extract|get)$/);
      const create = /[cru]/.test(bundle) || has(/^--(create|append|update)$/);
      const archive = value("-f", "--file") ?? (bundle.includes("f") ? files[0] : undefined);
      const into = value("-C", "--directory");
      if (archive) name(archive, create);
      if (extract) {
        if (into) name(into, true);
        else out.push({ kind: "here", known: true });
      } else
        all(
          false,
          files.filter((p) => p !== archive),
        );
      return true;
    }
    case "unzip": {
      const into = value("-d");
      all(false);
      if (into) name(into, true);
      else out.push({ kind: "here", known: true });
      return true;
    }
    case "zip":
      if (positional[0]) name(positional[0], true);
      all(false, positional.slice(1));
      return true;
    case "curl": {
      const target = value("-o", "--output");
      if (target) name(target, true);
      for (const k of ["-c", "-D", "--cookie-jar", "--dump-header", "--trace"]) {
        const v = value(k);
        if (v) name(v, true);
      }
      const up = value("-T", "--upload-file", "-K");
      if (up) name(up, false);
      if (has(/^(-O|--remote-name|-[a-zA-Z]*O[a-zA-Z]*)$/)) out.push({ kind: "here", known: true });
      all(false);
      return true;
    }
    case "wget": {
      const target = value("-O", "--output-document");
      const into = value("-P", "--directory-prefix");
      const log = value("-o", "-a");
      if (log) name(log, true);
      if (target) name(target, true);
      else if (into) name(into, true);
      else out.push({ kind: "here", known: true });
      return true;
    }
  }
  return false;
}

/** Programs that read text (their pattern or script is not a path) and only write where they are told. */
function textTool(c: Call): boolean {
  const { program, positional, name, value, has, all } = c;
  switch (program) {
    case "sed": {
      const inPlace = has(/^(-[a-zA-Z]*i|--in-place)/);
      const script = value("-f", "--file");
      if (script) name(script, false);
      all(inPlace, value("-e", "--expression") || script ? positional : positional.slice(1));
      return true;
    }
    case "grep":
    case "egrep":
    case "fgrep":
    case "zgrep":
    case "rg":
    case "ag":
    case "ack": {
      const file = value("-f", "--file");
      if (file) name(file, false);
      all(false, value("-e", "--regexp") || file || has(/^--(files|type-list)$/) ? positional : positional.slice(1));
      return true;
    }
    case "awk":
    case "gawk":
    case "jq":
    case "yq": {
      const file = value("-f", "--from-file");
      if (file) name(file, false);
      all(has(/^(-i|--inplace)$/), file ? positional : positional.slice(1));
      return true;
    }
    case "echo":
    case "printf":
      return true;
    case "sort":
    case "tree": {
      const target = value("-o", "--output");
      if (target) name(target, true);
      all(false);
      return true;
    }
    case "uniq":
      all(false, positional.slice(0, 1));
      if (positional[1]) name(positional[1], true);
      return true;
  }
  return false;
}

/** Programs that run other commands or act on a repository. */
function runner(c: Call): boolean {
  const { program, positional, args, out, home, depth } = c;
  switch (program) {
    case "find":
      out.push(...findPaths(args, home, depth));
      return true;
    case "git":
      out.push(...gitPaths(args, home));
      return true;
    case "xargs": {
      const file = c.value("-a");
      if (file) c.name(file, false);
      const inner = classify(positional, home, depth + 1);
      out.push(...inner);
      const runs = positional[0] ? path.basename(positional[0].text) : "echo";
      // Its targets come from its input: a program that writes them writes where only the input says.
      const inPlace = runs === "sed" && positional.some((a) => /^(-[a-zA-Z]*i|--in-place)/.test(a.text));
      if (CHANGE_ALL.has(runs) || COPIERS.has(runs) || inPlace || inner.some(writes))
        out.push({ kind: "unknown", text: "xargs", write: true });
      return true;
    }
    case "sh":
    case "bash":
    case "zsh":
    case "dash":
    case "ksh":
    case "eval": {
      const script =
        program === "eval" ? args.map((a) => a.text).join(" ") : c.has(/^-[a-z]*c$/) ? positional[0]?.text : undefined;
      if (script !== undefined && depth < 4) out.push(...namedPaths(script, home, depth + 1));
      else {
        c.all(false);
        out.push({ kind: "here", known: false });
      }
      return true;
    }
  }
  return false;
}

/** find's starting folders are written when it deletes or runs a program that changes things on what it finds. */
function findPaths(args: Word[], home: string, depth: number): Named[] {
  const out: Named[] = [];
  const starts: Word[] = [];
  let i = 0;
  while (i < args.length && !/^[-(!),]/.test(args[i]?.text ?? "")) starts.push(args[i++] as Word);
  let changes = false;
  for (; i < args.length; i++) {
    const t = args[i]?.text ?? "";
    if (t === "-delete") changes = true;
    else if (/^-(fprint0?|fprintf|fls)$/.test(t) && args[i + 1]) {
      const r = toRef(args[++i] as Word, home);
      if (r === "unknown") out.push({ kind: "unknown", text: t, write: true });
      else if (r) out.push({ kind: "path", to: r, write: true });
    } else if (/^-(exec|execdir|ok|okdir)$/.test(t)) {
      const sub: Word[] = [];
      for (i++; i < args.length && args[i]?.text !== ";" && args[i]?.text !== "+"; i++) sub.push(args[i] as Word);
      const program = path.basename(sub[0]?.text ?? "");
      const inner = classify(
        sub.filter((w) => w.text !== "{}"),
        home,
        depth + 1,
      );
      out.push(...inner.filter((n) => n.kind !== "here"));
      if (!READERS.has(program) || CHANGE_ALL.has(program) || inner.some(writes)) changes = true;
    }
  }
  for (const s of starts) {
    const r = toRef(s, home);
    if (r === "unknown") out.push({ kind: "unknown", text: s.text, write: changes });
    else if (r) out.push({ kind: "path", to: r, write: changes });
  }
  return out;
}

/** git reads or changes its repository: `-C <dir>` (or where it runs), as its subcommand says. */
function gitPaths(args: Word[], home: string): Named[] {
  const out: Named[] = [];
  let dir: Word | undefined;
  let i = 0;
  for (; i < args.length; i++) {
    const t = args[i]?.text ?? "";
    if (t === "-C" || t === "--git-dir" || t === "--work-tree") dir = args[++i];
    else if (/^--(git-dir|work-tree)=/.test(t)) dir = { ...(args[i] as Word), text: t.slice(t.indexOf("=") + 1) };
    else if (t === "-c" || t === "--namespace") i++;
    else if (!t.startsWith("-")) break;
  }
  const sub = args[i]?.text ?? "";
  const rest = args.slice(i + 1);
  const reads = GIT_READS.has(sub) || (GIT_LISTS[sub] !== undefined && rest.every((a) => GIT_LISTS[sub]?.test(a.text)));
  const named = (w: Word, write: boolean) => {
    const r = toRef(w, home);
    if (r === "unknown") out.push({ kind: "unknown", text: w.text, write });
    else if (r && dir && !path.isAbsolute(r.path)) {
      const base = toRef(dir, home);
      if (base && base !== "unknown")
        out.push({ kind: "path", to: { ...base, path: path.join(base.path, r.path) }, write });
      else out.push({ kind: "unknown", text: w.text, write });
    } else if (r) out.push({ kind: "path", to: r, write });
  };
  for (const a of rest) {
    const m = /^(--output|-o)(=(.*))?$/.exec(a.text);
    if (m?.[3]) named({ ...a, text: m[3] }, true);
    else if (m) {
      const next = rest[rest.indexOf(a) + 1];
      if (next) named(next, true);
    }
  }
  if (sub === "clone" || sub === "init") {
    const { positional } = split(rest);
    const target = sub === "clone" ? positional[1] : positional[0];
    if (target) named(target, true);
    else if (dir) named(dir, true);
    else out.push({ kind: "here", known: true });
    return out;
  }
  if (dir) {
    const r = toRef(dir, home);
    if (r === "unknown") out.push({ kind: "unknown", text: dir.text, write: !reads });
    else if (r) out.push({ kind: "path", to: r, write: !reads });
  } else if (!reads) out.push({ kind: "here", known: true });
  return out;
}

/** Everything a command line does with paths, in order (see Named). A bare `cd` goes home. */
export function namedPaths(command: string, home = os.homedir(), depth = 0): Named[] {
  const out: Named[] = [];
  for (const words of segments(command)) {
    const [first, ...rest] = words;
    if (!first) continue;
    if ((first.text === "cd" || first.text === "pushd") && !first.prose) {
      const to = rest.find((w) => !w.redirect && (w.text === "-" || !w.text.startsWith("-") || w.prose));
      for (const w of rest) if (w.redirect) out.push(...classify([w], home, depth));
      if (!to) out.push({ kind: "cd", to: { path: home } });
      else if (to.text === "-") out.push({ kind: "cd", to: undefined });
      else {
        const r = toRef({ ...to, prose: false }, home);
        out.push({ kind: "cd", to: r === "unknown" ? undefined : (r ?? { path: "." }) });
      }
      continue;
    }
    if (first.text === "popd") {
      out.push({ kind: "cd", to: undefined });
      continue;
    }
    out.push(...classify(words, home, depth));
  }
  return out;
}
