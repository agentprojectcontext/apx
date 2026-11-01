import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { commandRunner, currentVersion, switchCurrent } from "../../../../packages/install/src/release.ts";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { type DoctorFacts, diagnose, updateWithoutCore } from "./doctor.ts";

const bundle = { kind: "bundle" as const, app: "~/.apx/v2/app", version: "2.12.1" };
const facts = (over: Partial<DoctorFacts>): DoctorFacts => ({
  url: "http://127.0.0.1:7440",
  install: bundle,
  service: "running",
  releases: "https://github.com/acme/apx/releases/latest",
  ...over,
});
const missing = [
  '{"msg":"apx core listening","url":"http://127.0.0.1:7440"}',
  "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/x/packages/protocol/src/flow-edit.ts'",
  "Node.js v24.11.1",
];

test("a core that stops on missing files is told to update, the way its install updates", () => {
  const d = diagnose(facts({ log: missing, service: "stopped" }));
  assert.equal(d.ok, false);
  assert.ok(d.lines.includes("Why: This APX version is missing files, so its core cannot start."));
  assert.deepEqual(d.next, ["apx update"]);
  assert.deepEqual(diagnose(facts({ log: missing, install: { kind: "app" } })).next, [
    "Download the newest APX app: https://github.com/acme/apx/releases/latest",
  ]);
});

test("an error before the core's last start is history, not the cause", () => {
  const d = diagnose(facts({ log: [...missing, '{"msg":"apx core listening"}'], service: "stopped" }));
  assert.equal(
    d.lines.some((l) => l.startsWith("Why:")),
    false,
  );
  assert.deepEqual(d.next, ["apx service restart"]);
});

test("a taken port names the command that shows who holds it", () => {
  const d = diagnose(facts({ log: ["Error: listen EADDRINUSE: address already in use 127.0.0.1:7440"] }));
  assert.ok(d.lines.includes("Why: Another program already uses port 7440."));
  assert.deepEqual(d.next, ["See which one: lsof -nP -iTCP:7440 -sTCP:LISTEN"]);
});

test("a bundle with no service and no log yet is told to install the service", () => {
  const d = diagnose(facts({ service: "none" }));
  assert.ok(d.lines.includes("Log: the core has not written one on this home yet"));
  assert.deepEqual(d.next, ["apx service install"]);
});

test("a core that answers is fine, and a newer release is offered", () => {
  const core = { version: "2.12.1", code_sha: "abc123" };
  assert.deepEqual(diagnose(facts({ core })).next, []);
  const d = diagnose(facts({ core, latest: "2.12.3" }));
  assert.equal(d.ok, true);
  assert.ok(d.lines.includes("Newer: APX 2.12.3 is out"));
  assert.deepEqual(d.next, ["apx update"]);
});

/** A bundle install at 2.12.1 and a feed that serves 2.12.2's bundle for linux-x64. */
async function feed(dir: string) {
  const app = path.join(dir, "app");
  fs.mkdirSync(path.join(app, "versions", "2.12.1", "node", "bin"), { recursive: true });
  switchCurrent(app, "2.12.1");
  const src = path.join(dir, "src");
  fs.mkdirSync(path.join(src, "apx", "node", "bin"), { recursive: true });
  fs.writeFileSync(path.join(src, "apx", "node", "bin", "node"), "new");
  const name = "apx-core-2.12.2-linux-x64.tar.gz";
  // Relative paths: Git's tar on Windows reads "C:" in a path as a remote host.
  execFileSync("tar", ["-czf", name, "apx"], { cwd: src });
  const tarball = fs.readFileSync(path.join(src, name));
  const digest = createHash("sha256").update(tarball).digest("hex");
  const server = http.createServer((req, res) => {
    if (req.url === "/releases?per_page=100") return res.end(JSON.stringify(releases));
    if (req.url === `/${name}`) return res.end(tarball);
    if (req.url === `/${name}.sha256`) return res.end(`${digest}  ${name}\n`);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const releases = [
    {
      tag_name: "v2.12.2",
      assets: [name, `${name}.sha256`].map((n) => ({ name: n, browser_download_url: `${base}/${n}` })),
    },
  ];
  return { app, base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("with the core down, update puts the newest bundle in place and has the service start it", async () => {
  await using dir = tempDir("apx-doctor-");
  const f = await feed(dir.path);
  try {
    let restarts = 0;
    const lines = await updateWithoutCore({
      app: f.app,
      feed: f.base,
      current: "2.12.1",
      platform: { os: "linux", arch: "x64" },
      fetch,
      run: commandRunner(dir.path),
      service: "running",
      restart: async () => {
        restarts++;
      },
    });
    assert.equal(currentVersion(f.app), "2.12.2");
    assert.equal(fs.readFileSync(path.join(f.app, "current", "node", "bin", "node"), "utf8"), "new");
    assert.equal(restarts, 1);
    assert.match(lines[0] ?? "", /^APX 2\.12\.2 is installed/);
    assert.equal(lines[1], "The service is starting it: apx status");
  } finally {
    await f.close();
  }
});

test("update without the core changes nothing when this is the newest, and never starts a missing service", async () => {
  await using dir = tempDir("apx-doctor-");
  const f = await feed(dir.path);
  try {
    let restarts = 0;
    const o = {
      app: f.app,
      feed: f.base,
      platform: { os: "linux" as const, arch: "x64" as const },
      fetch,
      run: commandRunner(dir.path),
      restart: async () => {
        restarts++;
      },
    };
    assert.deepEqual(await updateWithoutCore({ ...o, current: "2.12.2", service: "running" }), [
      "APX 2.12.2 is the newest for this computer.",
      "To see why the core stops: apx doctor",
    ]);
    assert.equal(currentVersion(f.app), "2.12.1");
    const lines = await updateWithoutCore({ ...o, current: "2.12.1", service: "none" });
    assert.equal(lines[1], "Start it: apx service install");
    assert.equal(restarts, 0);
  } finally {
    await f.close();
  }
});
