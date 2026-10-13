// v2 takes APX v1's place on this machine: v1's daemon stops for good (two daemons would run the same routines and
// answer the same bots), v1's `apx` goes, and `apx` runs this APX. v1's files in ~/.apx stay, to import them.
import fs from "node:fs";
import path from "node:path";

/** The global npm package v1's `apx` comes from. */
export const V1_PACKAGE = "@agentprojectcontext/apx";
/** v1's daemon in a process list (its npm install or a checkout of it). */
const V1_DAEMON = "apx/src/host/daemon";

export type Run = (cmd: string, args: string[]) => Promise<{ code: number; out: string }>;

export type TakeoverDeps = {
  platform: NodeJS.Platform;
  home: string;
  uid: number;
  run: Run;
  /** v1's daemon answers on its port. */
  v1Running: () => Promise<boolean>;
  /** This APX's own command: apps/terminal/src/main.ts, and the program that runs it. */
  terminal: { main: string; exe: string; electron: boolean; appImage: boolean; checkout: boolean };
  wait?: (ms: number) => Promise<void>;
};

export type TakeoverResult = { ok: boolean; detail: string };

/** v1's daemon answers on its port: with v2 running beside it, routines and bots would run twice. */
export async function v1Answers(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Stops v1's daemon and its desktop's login item, so neither starts again at the next login. */
async function stopV1(d: TakeoverDeps): Promise<void> {
  const home = d.home;
  if (d.platform === "darwin") {
    for (const label of ["dev.apx.daemon", "dev.apx.desktop"]) {
      if (!fs.existsSync(path.join(home, "Library", "LaunchAgents", `${label}.plist`))) continue;
      await d.run("launchctl", ["bootout", `gui/${d.uid}/${label}`]);
      // A plist left in LaunchAgents loads again at login unless launchd is told it is off.
      await d.run("launchctl", ["disable", `gui/${d.uid}/${label}`]);
    }
  } else if (d.platform === "linux") {
    if (fs.existsSync(path.join(home, ".config", "systemd", "user", "apx-daemon.service")))
      await d.run("systemctl", ["--user", "disable", "--now", "apx-daemon.service"]);
    const autostart = path.join(home, ".config", "autostart", "apx-desktop.desktop");
    if (fs.existsSync(autostart)) fs.renameSync(autostart, `${autostart}.off`);
  } else if (d.platform === "win32") {
    for (const name of ["APXDaemon", "APXDesktop"])
      await d.run("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", name, "/f"]);
    await d.run("powershell", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'apx[\\\\/]src[\\\\/]host[\\\\/]daemon' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    ]);
  }
  // One started by hand (`apx daemon start`) has no service to stop.
  if (d.platform !== "win32") await d.run("pkill", ["-f", V1_DAEMON]);
}

/** Removes v1's global `apx`; says what to run when that needs administrator rights. */
async function removeV1Command(d: TakeoverDeps): Promise<string | undefined> {
  let left: string | undefined;
  const npm = await d.run("npm", ["ls", "-g", "--depth=0", V1_PACKAGE]);
  if (npm.code === 0 && npm.out.includes(V1_PACKAGE)) {
    const gone = await d.run("npm", ["uninstall", "-g", V1_PACKAGE]);
    if (gone.code !== 0) left = `${d.platform === "win32" ? "" : "sudo "}npm uninstall -g ${V1_PACKAGE}`;
  }
  const pnpm = await d.run("pnpm", ["ls", "-g", "--depth=0"]);
  if (pnpm.code === 0 && pnpm.out.includes(V1_PACKAGE)) await d.run("pnpm", ["remove", "-g", V1_PACKAGE]);
  return left;
}

const quoteSh = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Makes `apx` run this APX: the checkout's link, or a launcher next to the one install.sh writes. */
async function linkV2(d: TakeoverDeps): Promise<{ ok: boolean; detail: string }> {
  const { terminal: t } = d;
  if (t.checkout) {
    const linked = await d.run("pnpm", ["--dir", path.resolve(t.main, "../.."), "link", "--global"]);
    return linked.code === 0
      ? { ok: true, detail: "apx runs this checkout" }
      : { ok: false, detail: `pnpm link failed: ${linked.out.trim().slice(-200)}` };
  }
  // An AppImage's files live in a folder that is gone once it closes: the install line gives a lasting command.
  if (t.appImage)
    return {
      ok: false,
      detail: "for the apx command, run: curl -fsSL https://agentprojectcontext.github.io/apx/v2/install.sh | bash",
    };
  const node = t.electron ? "ELECTRON_RUN_AS_NODE=1 " : "";
  if (d.platform === "win32") {
    const bin = path.join(d.home, ".apx", "v2", "app", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(
      path.join(bin, "apx.cmd"),
      `@echo off\r\n${t.electron ? "set ELECTRON_RUN_AS_NODE=1\r\n" : ""}"${t.exe}" --disable-warning=ExperimentalWarning "${t.main}" %*\r\n`,
    );
    await d.run("powershell", [
      "-NoProfile",
      "-Command",
      `$p = [Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains '${bin}')) { [Environment]::SetEnvironmentVariable('Path', ('${bin};' + $p).TrimEnd(';'), 'User') }`,
    ]);
    return { ok: true, detail: "apx runs this APX (open a new terminal)" };
  }
  const bin = path.join(d.home, ".local", "bin");
  const file = path.join(bin, "apx");
  // install.sh's own launcher already runs v2.
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("written by install.sh"))
    return { ok: true, detail: "apx runs this APX" };
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    file,
    `#!/bin/sh\n# The APX command, written by the APX app.\n${node}exec ${quoteSh(t.exe)} --disable-warning=ExperimentalWarning ${quoteSh(t.main)} "$@"\n`,
    { mode: 0o755 },
  );
  // Like install.sh: ~/.local/bin goes on the PATH of the shells that do not have it yet.
  for (const rc of [".zshrc", ".bashrc", ".profile"]) {
    const f = path.join(d.home, rc);
    if (fs.existsSync(f) && !fs.readFileSync(f, "utf8").includes(".local/bin"))
      fs.appendFileSync(f, '\n# Added by APX\nexport PATH="$HOME/.local/bin:$PATH"\n');
  }
  return { ok: true, detail: "apx runs this APX (open a new terminal)" };
}

export async function takeOverV1(d: TakeoverDeps): Promise<TakeoverResult> {
  const wait = d.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  await stopV1(d);
  let stopped = !(await d.v1Running());
  for (let i = 0; i < 10 && !stopped; i++) {
    await wait(300);
    stopped = !(await d.v1Running());
  }
  const left = await removeV1Command(d);
  const link = await linkV2(d);
  const lines = [
    stopped ? "APX v1's daemon is off and will not start at login" : "APX v1 still answers: quit it from its own app",
    left ? `v1's apx needs administrator rights to go: ${left}` : "v1's apx is gone",
    link.detail,
  ];
  return { ok: stopped && !left && link.ok, detail: lines.join(". ") };
}
