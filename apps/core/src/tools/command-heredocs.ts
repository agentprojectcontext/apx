// Which text of a command line is shell code, before the destructive-command rule reads it (DECISIONS.md#d-264).
import path from "node:path";

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
 * the shell runs. Its terminator line stays, so the line still parses.
 */
export function shellCode(c: string): string {
  let out = "";
  let lineAt = 0;
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
  return out;
}
