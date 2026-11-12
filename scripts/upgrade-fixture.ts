import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { waitFor } from "../apps/core/src/testkit/platform.ts";
import { ApxClient } from "../packages/protocol/src/client.ts";

export const hashFile = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export async function command(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; ms?: number } = {},
) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.ms ?? 120_000,
  });
  let out = "";
  child.stdout.on("data", (b: Buffer) => {
    out += b.toString();
  });
  child.stderr.on("data", (b: Buffer) => {
    out += b.toString();
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed (${String(code)}): ${out.slice(-12_000)}`);
  return out;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, "exit");
  child.kill("SIGTERM");
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    await ended;
  } finally {
    clearTimeout(watchdog);
  }
}

export async function bundledCore(root: string, env: NodeJS.ProcessEnv, logFile: string) {
  let stopping = false;
  let failure: Error | undefined;
  let log = "";
  const keep = (bytes: Buffer) => {
    const text = bytes.toString();
    log = (log + text).slice(-32_000);
    fs.appendFileSync(logFile, text);
  };
  const launch = () => {
    const child = spawn(path.join(root, "node/bin/node"), [path.join(root, "apps/core/src/main.ts")], {
      env: { ...env, APX_SUPERVISED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) => {
      failure = error;
    });
    child.once("exit", (code) => {
      if (code === 75 && !stopping) current = launch();
    });
    return child;
  };
  let current = launch();
  const close = async () => {
    stopping = true;
    await stop(current);
  };
  try {
    const url = await waitFor(
      () => {
        if (failure) throw failure;
        if (current.exitCode !== null || current.signalCode !== null) throw new Error(log);
        return /apx core listening[^\n]*"url":"([^"]+)/.exec(log)?.[1];
      },
      "isolated installed core",
      { ms: 30_000 },
    );
    return { close, url, client: new ApxClient({ url, timeoutMs: 120_000 }) };
  } catch (error) {
    await close();
    throw error;
  }
}

export function checkedArtifact(directory: string, name: string) {
  const file = path.join(directory, name);
  const expected = /^[a-f0-9]{64}\b/i.exec(fs.readFileSync(`${file}.sha256`, "utf8"))?.[0].toLowerCase();
  const actual = hashFile(file);
  assert.equal(actual, expected, `checksum for ${name}`);
  return { name, sha256: actual };
}

export async function previousArtifacts(version: string, directory: string, repo: string) {
  fs.mkdirSync(directory, { recursive: true });
  for (const pattern of [`apx-core-${version}-mac-arm64.tar.gz*`, `APX-${version}-mac-arm64.zip*`]) {
    await command(
      "gh",
      ["release", "download", `v${version}`, "--repo", repo, "--pattern", pattern, "--dir", directory, "--clobber"],
      { ms: 300_000 },
    );
  }
  return [
    checkedArtifact(directory, `apx-core-${version}-mac-arm64.tar.gz`),
    checkedArtifact(directory, `APX-${version}-mac-arm64.zip`),
  ];
}

export async function releaseFixture(directory: string, target: string) {
  const names = fs
    .readdirSync(directory)
    .filter((name) =>
      [`apx-core-${target}-mac-arm64.tar.gz`, `APX-${target}-mac-arm64.zip`, `APX-${target}-mac-arm64.dmg`].some(
        (asset) => name === asset || name === `${asset}.sha256`,
      ),
    );
  const assets = names.filter((name) => !name.endsWith(".sha256")).map((name) => checkedArtifact(directory, name));
  assert.equal(assets.length, 3, "candidate must contain the daemon, ZIP, DMG and checked sidecars");
  let url = "";
  const server = http.createServer((req, res) => {
    const resource = new URL(req.url ?? "/", "http://localhost").pathname.slice(1);
    if (resource === "releases") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify([
          {
            tag_name: `v${target}`,
            draft: false,
            prerelease: false,
            body: "Isolated upgrade candidate",
            assets: names.map((name) => ({ name, browser_download_url: `${url}/${name}` })),
          },
        ]),
      );
    } else if (names.includes(resource)) fs.createReadStream(path.join(directory, resource)).pipe(res);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    assets,
    close: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

export function appVersion(bundle: string) {
  return execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", path.join(bundle, "Contents/Info.plist")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
