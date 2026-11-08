// The computer the core runs on, as its owner knows it: macOS's own name for it (the one in System Settings), else
// its network name without ".local".
import { execFile } from "node:child_process";
import os from "node:os";

export type HostOs = "macos" | "windows" | "linux" | "other";

export const hostOs = (platform: NodeJS.Platform = process.platform): HostOs =>
  platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : "other";

/** Read once: it changes only when the owner renames the computer. */
let named: Promise<string> | undefined;

export function hostName(): Promise<string> {
  named ??= new Promise((resolve) => {
    const network = os.hostname().replace(/\.local$/i, "") || "localhost";
    if (process.platform !== "darwin") return resolve(network);
    execFile("scutil", ["--get", "ComputerName"], { timeout: 2_000 }, (failure, out) =>
      resolve(!failure && out.trim() ? out.trim() : network),
    );
  });
  return named;
}
