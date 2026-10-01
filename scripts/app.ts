#!/usr/bin/env node
// `pnpm app`: builds the panel and the desktop shell, starts the core (which serves the panel) and opens the app.
// Ctrl+C stops both.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const step = (args: string[]) => {
  const r = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
step(["--filter", "@apx/ui", "build"]);
step(["--filter", "@apx/web", "build"]);
step(["--filter", "@apx/desktop", "build"]);

const core = spawn(process.execPath, ["apps/core/src/main.ts"], { cwd: root, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 1500));
const electron = path.join(root, "apps/desktop/node_modules/.bin/electron");
const desktop = spawn(electron, ["."], {
  cwd: path.join(root, "apps/desktop"),
  stdio: "inherit",
  env: { ...process.env, APX_WEB_URL: process.env.APX_WEB_URL ?? "http://127.0.0.1:7440" },
});
const stop = () => {
  desktop.kill();
  core.kill();
};
desktop.on("exit", () => {
  core.kill();
  process.exit(0);
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
