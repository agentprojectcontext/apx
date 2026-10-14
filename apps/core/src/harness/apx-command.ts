// The `apx` command agents run in their shells. APX's guides teach agents to use it, but a desktop install has none
// on the PATH, and an agent's shell does not read the owner's profile anyway. The core writes its own launcher at start,
// pointed at this core (its home and port, never its token), and puts its folder first on every agent's PATH.
import fs from "node:fs";
import path from "node:path";

const quoteSh = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** How this process runs the terminal: its executable, the CLI's entry, and whether it is Electron acting as Node. */
export type CommandRunner = { exe: string; main: string; electron: boolean };

/**
 * Writes `<home>/bin/apx` (and `apx.cmd` on Windows) running this core's own terminal against this home and port.
 * Returns the folder to put on agents' PATH, or undefined when this APX has no terminal to run.
 */
export function writeApxCommand(
  home: string,
  port: number,
  runner: CommandRunner,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!fs.existsSync(runner.main)) return undefined;
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  if (platform === "win32") {
    const cmd = [
      "@echo off",
      ...(runner.electron ? ["set ELECTRON_RUN_AS_NODE=1"] : []),
      `set "APX_HOME=${home}"`,
      `set "APX_PORT=${port}"`,
      `"${runner.exe}" --disable-warning=ExperimentalWarning "${runner.main}" %*`,
      "",
    ].join("\r\n");
    fs.writeFileSync(path.join(bin, "apx.cmd"), cmd);
    return bin;
  }
  const script = [
    "#!/bin/sh",
    "# The apx command for agents' shells, written by the APX core at start.",
    ...(runner.electron ? ["export ELECTRON_RUN_AS_NODE=1"] : []),
    `export APX_HOME=${quoteSh(home)}`,
    `export APX_PORT=${port}`,
    `exec ${quoteSh(runner.exe)} --disable-warning=ExperimentalWarning ${quoteSh(runner.main)} "$@"`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "apx"), script, { mode: 0o755 });
  return bin;
}

/** This core's own terminal, as the running process would start it. */
export function thisRunner(): CommandRunner {
  return {
    exe: process.execPath,
    main: path.resolve(import.meta.dirname, "../../../terminal/src/main.ts"),
    electron: Boolean(process.versions.electron),
  };
}
