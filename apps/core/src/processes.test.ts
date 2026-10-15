import assert from "node:assert/strict";
import { test } from "node:test";
import { commandShell, findGitBash, processStart, spawnCommand, stopTree } from "./processes.ts";

const has = (...files: string[]) => {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return (f: string) => set.has(f.toLowerCase());
};

test("Unix runs commands with /bin/sh -c", () => {
  const sh = commandShell("linux", {}, () => false);
  assert.equal(sh.file, "/bin/sh");
  assert.deepEqual(sh.args("echo hi"), ["-c", "echo hi"]);
  assert.equal(sh.name, "sh");
});

test("Windows finds Git Bash from the git on the PATH, and never WSL's bash in System32", () => {
  const env = { Path: "C:\\Windows\\System32;D:\\Tools\\Git\\cmd", SystemRoot: "C:\\Windows" };
  const exists = has(
    "C:\\Windows\\System32\\bash.exe",
    "D:\\Tools\\Git\\cmd\\git.exe",
    "D:\\Tools\\Git\\bin\\bash.exe",
  );
  const sh = commandShell("win32", env, exists);
  assert.equal(sh.file, "D:\\Tools\\Git\\bin\\bash.exe");
  assert.deepEqual(sh.args("ls -la"), ["-c", "ls -la"]);
  assert.equal(sh.name, "sh");
  assert.equal(findGitBash({ PATH: "C:\\Windows\\System32" }, exists), undefined);
});

test("Windows finds Git Bash in its usual folders, also from a mingw64 git on the PATH", () => {
  assert.equal(
    findGitBash({ PROGRAMFILES: "C:\\Program Files" }, has("C:\\Program Files\\Git\\bin\\bash.exe")),
    "C:\\Program Files\\Git\\bin\\bash.exe",
  );
  assert.equal(
    findGitBash({ PATH: "E:\\Git\\mingw64\\bin" }, has("E:\\Git\\mingw64\\bin\\git.exe", "E:\\Git\\bin\\bash.exe")),
    "E:\\Git\\bin\\bash.exe",
  );
});

test("Windows without Git Bash runs PowerShell with the command encoded, quotes intact", () => {
  const env = { PATH: "C:\\Windows\\System32", SystemRoot: "C:\\Windows" };
  const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const sh = commandShell("win32", env, has(ps));
  assert.equal(sh.file, ps);
  assert.equal(sh.name, "PowerShell");
  const args = sh.args(`Write-Output "a 'b'"`);
  assert.equal(args.at(-2), "-EncodedCommand");
  assert.equal(Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le"), `Write-Output "a 'b'"`);
  assert.equal(commandShell("win32", { PATH: "C:\\PS7" }, has("C:\\PS7\\pwsh.exe")).file, "C:\\PS7\\pwsh.exe");
});

test("a command's tree is stopped, and its start time names it while it runs", async (t) => {
  if (process.platform === "win32") return t.skip("covered by the Unix run");
  const child = spawnCommand("sleep 30 & sleep 30", { cwd: process.cwd(), env: {}, stdio: "ignore" });
  const pid = child.pid as number;
  assert.ok(await processStart(pid));
  const closed = new Promise((r) => child.on("close", r));
  stopTree(pid, { graceMs: 0 });
  await closed;
  assert.equal(await processStart(pid), undefined);
});
