#!/usr/bin/env node
// A release feed shaped like GitHub's, served from folders of `pnpm package` output: installs and updates can be
// tried on other machines of the network before anything is published.
//
//   node scripts/install/feed.ts out/ [more folders…] [--port 7480]
//   curl -fsSL http://<this-computer>:7480/install.sh | bash -s -- --feed http://<this-computer>:7480
//   APX_RELEASES=http://<this-computer>:7480 apx upgrade
//
// GET /releases lists one release per version found in the file names; GET /download/v<x.y.z>/<file> serves it;
// GET /install.sh and /install.ps1 serve the newest folder's scripts.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { compareVersions } from "../../packages/protocol/src/releases.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--port");
const port = at >= 0 ? Number(args[at + 1]) : 7480;
const dirs = args.filter((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1)).map((d) => path.resolve(d));
if (!dirs.length) throw new Error("usage: node scripts/install/feed.ts <folder…> [--port 7480]");

// apx-core-2.2.0-linux-x64.tar.gz, APX-2.2.0-win-x64.exe(.sha256), APX-2.2.0-android.apk
const VERSIONED = /^(?:apx-core|APX)-(\d+\.\d+\.\d+)-/;

function files(): Map<string, string> {
  const out = new Map<string, string>();
  for (const dir of dirs)
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      if (fs.statSync(path.join(dir, name)).isFile()) out.set(name, path.join(dir, name));
  return out;
}

function releases(base: string) {
  const byVersion = new Map<string, string[]>();
  for (const name of files().keys()) {
    const v = VERSIONED.exec(name)?.[1];
    if (v) byVersion.set(v, [...(byVersion.get(v) ?? []), name]);
  }
  return [...byVersion.entries()]
    .sort(([a], [b]) => compareVersions(b, a))
    .map(([v, names]) => ({
      tag_name: `v${v}`,
      draft: false,
      prerelease: false,
      body: `- APX ${v} from a local feed`,
      assets: names.sort().map((name) => ({ name, browser_download_url: `${base}/download/v${v}/${name}` })),
    }));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://feed");
    const base = `http://${req.headers.host ?? `127.0.0.1:${port}`}`;
    const all = files();
    const name =
      url.pathname === "/install.sh" || url.pathname === "/install.ps1"
        ? url.pathname.slice(1)
        : /^\/download\/v[^/]+\/([^/]+)$/.exec(url.pathname)?.[1];
    console.log(`${req.method} ${url.pathname}`);
    if (url.pathname === "/releases") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(releases(base), null, 1));
    } else if (name && all.has(name)) {
      const file = all.get(name) as string;
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": fs.statSync(file).size });
      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404).end("not found\n");
    }
  })
  .listen(port, "0.0.0.0", () => {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    console.log(`release feed on http://${lan ?? "127.0.0.1"}:${port} from ${dirs.join(", ")}`);
  });
