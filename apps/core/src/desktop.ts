// What the owner's machine does with a file outside APX: show it in Finder (Explorer, the file manager) or move it to
// the system trash, where it can still be recovered. Paths go as arguments or environment, never inside a script.
import { execFile } from "node:child_process";
import path from "node:path";

export type DesktopOps = {
  reveal(abs: string): Promise<void>;
  trash(abs: string): Promise<void>;
};

const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  new Promise<void>((resolve, reject) =>
    execFile(cmd, args, { timeout: 15_000, env: { ...process.env, ...env } }, (err) => (err ? reject(err) : resolve())),
  );

export const systemDesktop: DesktopOps = {
  reveal(abs) {
    if (process.platform === "darwin") return run("open", ["-R", abs]);
    if (process.platform === "win32") return run("explorer.exe", [`/select,${abs}`]).catch(() => {});
    return run("xdg-open", [path.dirname(abs)]);
  },
  trash(abs) {
    if (process.platform === "darwin")
      return run("osascript", [
        "-e",
        "on run argv",
        "-e",
        'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
        "-e",
        "end run",
        abs,
      ]);
    if (process.platform === "win32")
      return run(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Add-Type -AssemblyName Microsoft.VisualBasic; $p=$env:APX_TRASH_PATH; if (Test-Path $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }",
        ],
        { APX_TRASH_PATH: abs },
      );
    return run("gio", ["trash", abs]);
  },
};
