import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const electron = fs.realpathSync(path.join(root, "apps/desktop/node_modules/electron/package.json"));
if (!fs.existsSync(path.join(path.dirname(electron), "dist/Electron.app")))
  execFileSync(process.execPath, [path.join(path.dirname(electron), "install.js")], { cwd: root, stdio: "inherit" });
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("This prototype requires macOS Apple Silicon");
const runtime = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.homedir(), ".apx/v2/labs/apx-vm-lab-demo");
if (!path.basename(runtime).startsWith("apx-vm-lab-")) throw new Error("Use a dedicated apx-vm-lab-* runtime folder");
const limaHome = path.join(runtime, "lima");
if (limaHome.length > 60) throw new Error("Use a shorter runtime path for Lima's SSH sockets");
fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
process.stdout.write(`Prototype runtime: ${runtime}\n`);
for (const args of [["build:web"], ["--filter", "@apx/desktop", "build"]])
  execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });
const child = spawn(process.execPath, ["prototypes/vm-desktop/launch.ts", runtime, ...process.argv.slice(3)], {
  cwd: root,
  stdio: "inherit",
});
process.once("SIGINT", () => child.kill("SIGINT"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
child.once("exit", (code) => process.exit(code ?? 1));
