import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const helper = pathToFileURL(path.join(import.meta.dirname, "exit.ts")).href;
const run = (body: string) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", `import { exitWhenClosed } from "${helper}";\n${body}`], {
    encoding: "utf8",
    timeout: 20_000,
  });

test("a process ends with its code once the handle it was closing is closed", () => {
  const r = run(`import net from "node:net";
const server = net.createServer().listen(0, "127.0.0.1", () => {
  server.close();
  exitWhenClosed(3);
  setImmediate(() => console.log("still ran"));
});`);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /still ran/, "the work already queued runs before the end");
});

test("a process kept alive by something nobody closes still ends, with its code, after the grace", () => {
  const started = Date.now();
  const r = run(`setInterval(() => {}, 1000);\nexitWhenClosed(4, 200);`);
  assert.equal(r.status, 4, r.stderr);
  assert.ok(Date.now() - started < 15_000);
});
