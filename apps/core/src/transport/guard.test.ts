import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createCore } from "../server.ts";

let core: Awaited<ReturnType<typeof createCore>>;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-guard-"));
const dist = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-dist-"));

before(async () => {
  fs.writeFileSync(path.join(dist, "index.html"), "<p>panel</p>");
  fs.mkdirSync(`${dist}-old`, { recursive: true });
  fs.writeFileSync(`${dist}-old/secret.txt`, "nope");
  core = await createCore({ host: "127.0.0.1", port: 0, home, token: undefined }, { quiet: true, webDist: dist });
});
after(async () => {
  await core.close();
  for (const d of [home, dist, `${dist}-old`]) fs.rmSync(d, { recursive: true, force: true });
});

const rpc = (headers: Record<string, string>, body = "{}") =>
  fetch(`${core.url}/rpc/system.ping`, { method: "POST", headers, body });

test("a foreign web page cannot call the RPC endpoint", async () => {
  assert.equal((await rpc({ origin: "https://evil.example", "content-type": "application/json" })).status, 403);
  // "Simple" cross-site posts (no preflight) are refused by content type.
  assert.equal((await rpc({ "content-type": "text/plain" })).status, 415);
  assert.equal((await rpc({ "content-type": "application/json" })).status, 200);
});

test("a foreign web page cannot open the socket", async () => {
  const ws = new WebSocket(`${core.url.replace("http", "ws")}/ws`, {
    headers: { origin: "https://evil.example" },
  } as never);
  const outcome = await new Promise<string>((resolve) => {
    ws.addEventListener("open", () => resolve("open"));
    ws.addEventListener("error", () => resolve("refused"));
  });
  assert.equal(outcome, "refused");
});

test("malformed paths do not crash the core and cannot escape the panel folder", async () => {
  assert.equal((await fetch(`${core.url}/%`)).status, 404);
  const escaped = await fetch(`${core.url}/..%2f${path.basename(dist)}-old%2fsecret.txt`);
  assert.notEqual(await escaped.text(), "nope");
  assert.equal((await fetch(`${core.url}/health`)).status, 200);
});
