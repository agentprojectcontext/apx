// The daemon on its own, for a server or a computer without the desktop app: what stage.ts laid out (core, terminal,
// panel, node_modules) plus a Node to run it, packed as out/apx-core-<version>-<os>-<arch>.tar.gz with a .sha256
// beside it. install.sh/ps1 and the core's own updates unpack it. Run after stage.ts; the target is the stage's.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BUNDLE, coreBundleName, nodeOs, type Platform, platformOf } from "@apx/protocol";

const root = path.resolve(import.meta.dirname, "..");
const stage = path.join(root, ".stage/apx");
const out = path.resolve(root, "../../out");
const build = JSON.parse(fs.readFileSync(path.join(stage, "build.json"), "utf8")) as {
  version: string;
  os?: Platform["os"];
  arch?: Platform["arch"];
};
const host = platformOf(process.platform, process.arch);
const target: Platform | undefined = build.os && build.arch ? { os: build.os, arch: build.arch } : host;
if (!target) throw new Error(`no daemon bundle for ${process.platform}-${process.arch}`);

// Windows' own bsdtar: Git's GNU tar (first on a runner's PATH) reads "C:" as a remote host.
const tar =
  process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** This Node's own release for another platform, from nodejs.org and checked against its SHASUMS256.txt. */
async function nodeFor(p: Platform, dest: string): Promise<void> {
  const v = process.version;
  const base = `https://nodejs.org/dist/${v}`;
  const file = p.os === "win" ? `node-${v}-win-${p.arch}.zip` : `node-${v}-${nodeOs(p)}-${p.arch}.tar.gz`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const want = sums
    .split("\n")
    .find((l) => l.endsWith(`  ${file}`))
    ?.split(" ")[0];
  const res = await fetch(`${base}/${file}`);
  if (!res.ok || !want) throw new Error(`no Node ${v} for ${p.os}-${p.arch} (${file})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== want) throw new Error(`${file} does not match nodejs.org's SHASUMS256.txt`);
  const tmp = fs.mkdtempSync(path.join(root, ".node-"));
  try {
    fs.writeFileSync(path.join(tmp, file), buf);
    // bsdtar (macOS, Windows) reads .zip too; on Linux a .zip goes through unzip.
    if (file.endsWith(".zip") && process.platform === "linux")
      execFileSync("unzip", ["-q", file], { cwd: tmp, stdio: "inherit" });
    else execFileSync(tar, ["-xf", file], { cwd: tmp, stdio: "inherit" });
    const dir = path.join(tmp, file.replace(/\.(zip|tar\.gz)$/, ""));
    fs.copyFileSync(path.join(dir, ...(p.os === "win" ? ["node.exe"] : ["bin", "node"])), dest);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The archive holds one folder, apx/, so unpacking never spills into the folder it lands in.
const work = path.join(root, ".bundle");
const top = path.join(work, "apx");
fs.rmSync(work, { recursive: true, force: true });
fs.cpSync(stage, top, { recursive: true, verbatimSymlinks: true });
const node = path.join(top, ...BUNDLE.node(target.os === "win"));
fs.mkdirSync(path.dirname(node), { recursive: true });
if (host && host.os === target.os && host.arch === target.arch) fs.copyFileSync(process.execPath, node);
else await nodeFor(target, node);
fs.chmodSync(node, 0o755);

fs.mkdirSync(out, { recursive: true });
const name = coreBundleName(build.version, target);
execFileSync(tar, ["-czf", name, "-C", path.relative(out, work), "apx"], { cwd: out, stdio: "inherit" });
const file = path.join(out, name);
fs.writeFileSync(`${file}.sha256`, `${sha256(fs.readFileSync(file))}  ${name}\n`);
fs.rmSync(work, { recursive: true, force: true });
console.log(`bundled out/${name} (${Math.round(fs.statSync(file).size / 1048576)} MB, Node ${process.version})`);
