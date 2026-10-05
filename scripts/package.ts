// `pnpm package[:mac|:linux|:win]`: everything a release carries for one platform, in out/ (git-ignored): the desktop
// installer, the daemon bundle for servers, a .sha256 beside each, and the install scripts.
//   node scripts/package.ts            this computer's platform
//   node scripts/package.ts linux      another one (native modules and Node come prebuilt for it), x64 unless --arm64
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { platformOf } from "../packages/protocol/src/releases.ts";
import { buildVersion } from "./version.ts";

const repo = path.resolve(import.meta.dirname, "..");
const out = path.join(repo, "out");
const desktop = path.join(repo, "apps/desktop");
const ELECTRON_BUILDER = "electron-builder@26.15.3";

const host = platformOf(process.platform, process.arch);
const args = process.argv.slice(2);
const os = (args.find((a) => !a.startsWith("--")) ?? host?.os) as string | undefined;
if (os !== "mac" && os !== "linux" && os !== "win")
  throw new Error("usage: node scripts/package.ts [mac|linux|win] [--x64|--arm64]");
const arch = args.includes("--arm64")
  ? "arm64"
  : args.includes("--x64")
    ? "x64"
    : host?.os === os
      ? host.arch
      : os === "mac"
        ? "arm64"
        : "x64";

const win = process.platform === "win32";
const step = (cmd: string, cmdArgs: string[], cwd = repo, env: NodeJS.ProcessEnv = process.env) => {
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd, env, stdio: "inherit", shell: win });
};

// A release's tag (CI sets package.json from it), or here the last tag and the commits past it.
const version = buildVersion(
  (JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8")) as { version: string }).version,
  repo,
);
const env = { ...process.env, APX_VERSION: version };

const before = new Set(fs.existsSync(out) ? fs.readdirSync(out) : []);
step("pnpm", ["build:web"]);
step("pnpm", ["--filter", "@apx/desktop", "build"]);
step("node", ["apps/desktop/scripts/stage.ts"], repo, { ...env, APX_TARGET: `${os}-${arch}` });
// npx with a cache of its own: sharing npm's with stage.ts's install compromised its lock on Windows runners.
step(
  "npx",
  [
    "--yes",
    "--cache",
    path.join(repo, "apps/desktop/.npx-cache"),
    ELECTRON_BUILDER,
    "--config",
    "electron-builder.json",
    "--publish",
    "never",
    `--${os}`,
    `--${arch}`,
    `-c.directories.output=${out}`,
    `-c.extraMetadata.version=${version}`,
  ],
  desktop,
);
step("node", ["apps/desktop/scripts/bundle.ts"]);

// What a release attaches: the installers (each with a .sha256 the desktop app checks) and the install scripts.
for (const f of fs.readdirSync(out)) {
  if (!/\.(AppImage|exe|dmg|zip)$/.test(f) || before.has(f)) continue;
  const digest = createHash("sha256")
    .update(fs.readFileSync(path.join(out, f)))
    .digest("hex");
  fs.writeFileSync(path.join(out, `${f}.sha256`), `${digest}  ${f}\n`);
}
for (const f of ["install.sh", "install.ps1"])
  fs.copyFileSync(path.join(repo, "scripts/install", f), path.join(out, f));
// electron-builder's working leftovers (unpacked apps, its own yml) are not release files.
for (const f of fs.readdirSync(out)) {
  if (/-unpacked$|^mac(-arm64)?$|^builder-|\.blockmap$|\.yml$/.test(f))
    fs.rmSync(path.join(out, f), { recursive: true, force: true });
}
console.log(`\nAPX ${version} for ${os}-${arch} in out/:`);
for (const f of fs.readdirSync(out).sort()) console.log(`  ${f}`);
