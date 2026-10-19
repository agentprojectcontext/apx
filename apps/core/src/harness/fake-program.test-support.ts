// A stand-in program for tests: a node script on Unix; on Windows, where only an .exe starts without a shell, a copy
// of node that runs the script's body in place of node's own main module.
import fs from "node:fs";
import path from "node:path";

export type FakeProgram = {
  bin: string;
  /** What the program's environment needs on top of the caller's (empty on Unix). */
  env: Record<string, string>;
};

/**
 * `name` in `dir`, running `body` as CommonJS with its arguments in `argv`. On Windows the first argument must not
 * start with "-" (node reads it as its own option), and reaches `argv` without any folder in front of it.
 */
export function fakeProgram(dir: string, name: string, body: string): FakeProgram {
  if (process.platform !== "win32") {
    const bin = path.join(dir, name);
    fs.writeFileSync(bin, `#!/usr/bin/env node\nconst argv = process.argv.slice(2);\n${body}\n`, { mode: 0o755 });
    return { bin, env: {} };
  }
  const bin = path.join(dir, `${name}.exe`);
  if (!fs.existsSync(bin)) fs.copyFileSync(process.execPath, bin);
  const preload = path.join(dir, `${name}.preload.cjs`);
  fs.writeFileSync(
    preload,
    `require("node:module").runMain = function () {\nconst argv = [require("node:path").basename(process.argv[1]), ...process.argv.slice(2)];\n${body}\n};\n`,
  );
  return { bin, env: { NODE_OPTIONS: `--require "${preload.split(path.sep).join("/")}"` } };
}
