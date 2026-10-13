import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type Run, takeOverV1, V1_PACKAGE, v1Answers } from "./v1-takeover.ts";

function world(platform: NodeJS.Platform, opts: { npmHasV1?: boolean; npmFails?: boolean; v1Stays?: boolean } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-takeover-"));
  const calls: string[] = [];
  let v1Up = true;
  const run: Run = async (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    if (cmd === "launchctl" || cmd === "systemctl" || cmd === "pkill") v1Up = Boolean(opts.v1Stays);
    if (line.startsWith("npm ls"))
      return { code: opts.npmHasV1 ? 0 : 1, out: opts.npmHasV1 ? `└── ${V1_PACKAGE}@1.125.0` : "" };
    if (line.startsWith("npm uninstall")) return { code: opts.npmFails ? 243 : 0, out: opts.npmFails ? "EACCES" : "" };
    if (cmd === "pnpm") return { code: -1, out: "spawn pnpm ENOENT" };
    return { code: 0, out: "" };
  };
  const terminal = {
    main: path.join(home, "App.app", "apx", "apps", "terminal", "src", "main.ts"),
    exe: path.join(home, "App.app", "MacOS", "APX"),
    electron: true,
    appImage: false,
    checkout: false,
  };
  const deps = { platform, home, uid: 501, run, v1Running: async () => v1Up, terminal, wait: async () => {} };
  return { home, calls, deps };
}

test("on a Mac v1's daemon and desktop are booted out and disabled, so login does not start them again", async () => {
  const { home, calls, deps } = world("darwin", { npmHasV1: true });
  const agents = path.join(home, "Library", "LaunchAgents");
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, "dev.apx.daemon.plist"), "<plist/>");
  fs.writeFileSync(path.join(agents, "dev.apx.desktop.plist"), "<plist/>");
  const res = await takeOverV1(deps);
  assert.equal(res.ok, true, res.detail);
  for (const label of ["dev.apx.daemon", "dev.apx.desktop"]) {
    assert.ok(calls.includes(`launchctl bootout gui/501/${label}`));
    assert.ok(calls.includes(`launchctl disable gui/501/${label}`));
  }
  assert.ok(calls.includes(`npm uninstall -g ${V1_PACKAGE}`));
  // The app's own command, run as Node by the app's executable, never pnpm.
  const launcher = fs.readFileSync(path.join(home, ".local", "bin", "apx"), "utf8");
  assert.match(launcher, /^#!\/bin\/sh\n/);
  assert.ok(launcher.includes(`ELECTRON_RUN_AS_NODE=1 exec '${deps.terminal.exe}'`));
  assert.ok(launcher.includes(`'${deps.terminal.main}' "$@"`));
  assert.equal(fs.statSync(path.join(home, ".local", "bin", "apx")).mode & 0o777, 0o755);
});

test("on Linux the systemd unit is disabled and the desktop's autostart entry put aside", async () => {
  const { home, calls, deps } = world("linux");
  fs.mkdirSync(path.join(home, ".config", "systemd", "user"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config", "systemd", "user", "apx-daemon.service"), "[Unit]");
  fs.mkdirSync(path.join(home, ".config", "autostart"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config", "autostart", "apx-desktop.desktop"), "[Desktop Entry]");
  fs.writeFileSync(path.join(home, ".bashrc"), "# mine\n");
  const res = await takeOverV1(deps);
  assert.equal(res.ok, true, res.detail);
  assert.ok(calls.includes("systemctl --user disable --now apx-daemon.service"));
  assert.ok(fs.existsSync(path.join(home, ".config", "autostart", "apx-desktop.desktop.off")));
  assert.match(fs.readFileSync(path.join(home, ".bashrc"), "utf8"), /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
});

test("what is left is said plainly: v1 still answering, or its apx needing administrator rights", async () => {
  const { deps } = world("darwin", { npmHasV1: true, npmFails: true, v1Stays: true });
  const res = await takeOverV1(deps);
  assert.equal(res.ok, false);
  assert.match(res.detail, /still answers/);
  assert.match(res.detail, new RegExp(`sudo npm uninstall -g ${V1_PACKAGE}`));
});

test("install.sh's launcher is left alone; an AppImage points at the install line", async () => {
  const a = world("linux");
  fs.mkdirSync(path.join(a.home, ".local", "bin"), { recursive: true });
  const mine = "#!/bin/sh\n# The APX command, written by install.sh.\n";
  fs.writeFileSync(path.join(a.home, ".local", "bin", "apx"), mine);
  assert.equal((await takeOverV1(a.deps)).ok, true);
  assert.equal(fs.readFileSync(path.join(a.home, ".local", "bin", "apx"), "utf8"), mine);
  const b = world("linux");
  const res = await takeOverV1({ ...b.deps, terminal: { ...b.deps.terminal, appImage: true } });
  assert.equal(res.ok, false);
  assert.match(res.detail, /install\.sh \| bash/);
});

test("v1 answers only when its health check does", async () => {
  const ok = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  const down = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  assert.equal(await v1Answers("http://127.0.0.1:7430", ok), true);
  assert.equal(await v1Answers("http://127.0.0.1:7430", down), false);
});
