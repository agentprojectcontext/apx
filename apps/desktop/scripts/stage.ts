// Lays out the core the installed app carries (resources/apx), in the repo's own shape so the core's relative paths
// hold: apps/core, apps/terminal (with the skills it installs in other runtimes), apps/web/dist, examples/agents, and
// a node_modules of real files (no workspace links: Node strips TypeScript only outside node_modules, so
// @apx/protocol goes in as a JavaScript bundle).
// Native modules are per platform (sharp, as prebuilt optional packages): APX_TARGET=<os>-<arch> (linux-x64, win-x64,
// mac-arm64) installs the target's instead of this machine's, so one computer can build for all three.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nodeOs, targetOf } from "@apx/protocol";
import { build } from "esbuild";
import { CLIENT_FILE, clientFromJson, clientFromPair } from "../../core/src/integrations/google-client.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const target = targetOf(process.env.APX_TARGET, process.platform, process.arch);
if (!target) throw new Error(`no build for ${process.env.APX_TARGET ?? `${process.platform}-${process.arch}`}`);
const out = path.join(repo, "apps/desktop/.stage/apx");
// pnpm package passes the version it builds (APX_VERSION); package.json's is a placeholder outside a release.
const version =
  process.env.APX_VERSION ||
  (JSON.parse(fs.readFileSync(path.join(repo, "apps/desktop/package.json"), "utf8")) as { version: string }).version;

fs.rmSync(out, { recursive: true, force: true });
const notTest = (src: string) => !/\.test\.(ts|mjs)$/.test(src);
const copy = (rel: string) =>
  fs.cpSync(path.join(repo, rel), path.join(out, rel), { recursive: true, filter: notTest, dereference: true });

const web = path.join(repo, "apps/web/dist/index.html");
if (!fs.existsSync(web)) throw new Error("build the panel first: pnpm build:web");
// install.sh too: the desktop app installs the daemon on a server over SSH with its own copy.
for (const rel of [
  "apps/core/src",
  "apps/terminal/src",
  "apps/terminal/skills",
  "apps/web/dist",
  "packages/surfaces/src",
  "packages/install/src",
  "examples/agents",
  "scripts/install/install.sh",
])
  copy(rel);
for (const app of ["core", "terminal"]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, `apps/${app}/package.json`), "utf8")) as Record<
    string,
    unknown
  >;
  fs.writeFileSync(
    path.join(out, `apps/${app}/package.json`),
    JSON.stringify({ name: pkg.name, version, type: "module", private: true }, null, 2),
  );
}

// The runtime dependencies of core and terminal, pinned to what this checkout runs.
const deps: Record<string, string> = {};
for (const app of ["core", "terminal"]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, `apps/${app}/package.json`), "utf8")) as {
    dependencies: Record<string, string>;
  };
  for (const name of Object.keys(pkg.dependencies)) {
    if (name.startsWith("@apx/")) continue;
    const installed = path.join(repo, `apps/${app}/node_modules`, name, "package.json");
    deps[name] = (JSON.parse(fs.readFileSync(installed, "utf8")) as { version: string }).version;
  }
}
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({ name: "apx-bundle", version, private: true, type: "module", dependencies: deps }, null, 2),
);
const platformFlags = [
  `--os=${nodeOs(target)}`,
  `--cpu=${target.arch}`,
  ...(target.os === "linux" ? ["--libc=glibc"] : []),
];
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", ...platformFlags], {
  cwd: out,
  stdio: "inherit",
  shell: process.platform === "win32",
});

// The agent SDKs pull a copy of the Claude Code and Codex CLIs as optional packages; APX runs the owner's own
// installed `claude` / `codex` instead (harness/index.ts), so those copies only add hundreds of MB.
for (const scope of ["@anthropic-ai", "@openai"]) {
  const dir = path.join(out, "node_modules", scope);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (/^claude-agent-sdk-|^codex$|^codex-(?!sdk$)/.test(name)) fs.rmSync(path.join(dir, name), { recursive: true });
  }
}
// The core never runs node_modules/.bin, and links left pointing at what was removed break the Linux zip.
fs.rmSync(path.join(out, "node_modules", ".bin"), { recursive: true, force: true });

// After npm (which prunes what package.json does not list).
const protocol = path.join(out, "node_modules/@apx/protocol");
await build({
  entryPoints: {
    index: path.join(repo, "packages/protocol/src/index.ts"),
    client: path.join(repo, "packages/protocol/src/client.ts"),
    cdp: path.join(repo, "packages/protocol/src/cdp.ts"),
  },
  outdir: protocol,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["zod"],
  logLevel: "warning",
});
fs.writeFileSync(
  path.join(protocol, "package.json"),
  JSON.stringify(
    {
      name: "@apx/protocol",
      version,
      type: "module",
      exports: { ".": "./index.js", "./client": "./client.js", "./cdp": "./cdp.js" },
    },
    null,
    2,
  ),
);

let sha = process.env.GITHUB_SHA?.slice(0, 12) ?? "";
if (!sha) {
  try {
    sha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repo }).toString().trim();
  } catch {}
}
fs.writeFileSync(
  path.join(out, "build.json"),
  JSON.stringify({ version, sha, os: target.os, arch: target.arch }, null, 2),
);
// APX's Google sign-in: CI's secret (`id:secret` or Cloud Console's JSON), or a checkout's own git-ignored file. Kept
// out of the repository; a build without it offers only the owner's own client (DECISIONS.md#d-130).
const google = process.env.APX_GOOGLE_CLIENT?.trim();
const client = google
  ? (clientFromJson(google) ?? clientFromPair(google))
  : fs.existsSync(path.join(repo, CLIENT_FILE))
    ? clientFromJson(fs.readFileSync(path.join(repo, CLIENT_FILE), "utf8"))
    : undefined;
if (google && !client) throw new Error("APX_GOOGLE_CLIENT is neither client_id:client_secret nor a client JSON");
if (client)
  fs.writeFileSync(
    path.join(out, CLIENT_FILE),
    JSON.stringify({ client_id: client.clientId, client_secret: client.clientSecret }, null, 2),
  );
console.log(client ? "Google sign-in: APX's own client" : "Google sign-in: none in this build");
// What each release changed, read from this checkout's tags now: the installed core has no git (DECISIONS.md#d-100).
execFileSync(
  process.execPath,
  [path.join(repo, "apps/core/src/release-notes.ts"), path.join(out, "release-notes.json")],
  {
    cwd: repo,
    stdio: "inherit",
  },
);
console.log(
  `staged APX ${version} (${sha || "no sha"}) for ${target.os}-${target.arch} in ${path.relative(repo, out)}`,
);
