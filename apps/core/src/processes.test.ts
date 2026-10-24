import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { commandShell, findGitBash, probeProcess, processStart, spawnCommand, stopTree } from "./processes.ts";

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

test("the chosen shell executes a command and returns its output", async () => {
  const child = spawnCommand("echo apx-ready", {
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
    stdio: "pipe",
  });
  let output = "";
  child.stdout?.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  assert.equal(code, 0);
  assert.match(output, /apx-ready/);
});

test("a command's tree is stopped, and its start time names it while it runs", { timeout: 20_000 }, async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      'const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(child.pid); setInterval(() => {}, 1000);',
    ],
    { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  const pid = child.pid as number;
  assert.ok(child.stdout);
  const descendant = await new Promise<number>((resolve, reject) => {
    child.stdout?.once("data", (bytes: Buffer) => resolve(Number(bytes.toString().trim())));
    child.once("error", reject);
  });
  try {
    assert.ok(Number.isInteger(descendant) && descendant > 0);
    assert.ok(await processStart(pid));
    assert.ok(await processStart(descendant));
    // Settled means gone: the whole tree, with nothing else waited on.
    await stopTree(pid, { graceMs: 0 });
    assert.equal(await processStart(pid), undefined);
    assert.equal(await processStart(descendant), undefined);
  } finally {
    await stopTree(pid, { graceMs: 0 });
  }
});

test("a probe that gets no answer in time says unknown, never that the process is gone", async () => {
  assert.equal((await probeProcess(process.pid, 1)).state, "unknown");
  // portable: 1 ms is shorter than any process start, so the probe always times out.
  await assert.rejects(processStart(process.pid, { attempts: 1, timeoutMs: 1 }), /cannot tell whether process/);
  assert.deepEqual(await probeProcess(process.pid), { state: "running", start: await processStart(process.pid) });
});

test("a process that is gone is gone, and a TERM it obeys ends the stop before its grace", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
  });
  const pid = child.pid as number;
  const started = performance.now();
  await stopTree(pid, { graceMs: 20_000 });
  assert.ok(performance.now() - started < 10_000, "the stop waited out its grace");
  assert.deepEqual(await probeProcess(pid), { state: "gone" });
});
