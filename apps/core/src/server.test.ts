import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { assertSafeBind, testConfig } from "./config.ts";
import { createCore } from "./server.ts";
import { removeDir } from "./testkit/platform.ts";

let core: Awaited<ReturnType<typeof createCore>>;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-test-"));

before(async () => {
  core = await createCore(testConfig({ home }), { quiet: true });
});
after(async () => {
  await core.close();
  await removeDir(home);
});

test("health over HTTP carries code_sha and a stable home id", async () => {
  const client = new ApxClient({ url: core.url });
  const h = await client.call("system.health", {});
  assert.equal(h.name, "apx-core");
  assert.ok(h.code_sha.length > 0);
  assert.equal(h.home_id, fs.readFileSync(path.join(home, "home-id"), "utf8").trim());
});

test("an idle connection stays open far longer than a client reuses one", async () => {
  const agent = new http.Agent({ keepAlive: true });
  const res = await new Promise<http.IncomingMessage>((resolve, reject) =>
    http.get(`${core.url}/health`, { agent }, resolve).on("error", reject),
  );
  res.resume();
  agent.destroy();
  // fetch keeps a connection for about 4 s; Node's default here (5 s) let a stalled client reuse a closing one.
  const timeout = Number(/timeout=(\d+)/.exec(String(res.headers["keep-alive"]))?.[1]);
  assert.ok(timeout >= 60, `keep-alive ${res.headers["keep-alive"]}`);
});

test("the socket and HTTP reach the same handler", async () => {
  const client = new ApxClient({ url: core.url });
  const socket = await client.connect();
  assert.equal(socket.welcome?.server.code_sha, core.identity.code_sha);
  const viaWs = await socket.call("system.ping", { echo: "hola" });
  const viaHttp = await client.call("system.ping", { echo: "hola" });
  assert.equal(viaWs.pong, viaHttp.pong);
  socket.close();
});

test("the panel may call the actual bound ephemeral port, while foreign origins are refused", async () => {
  const request = (origin: string) =>
    fetch(`${core.url}/rpc/system.ping`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: "{}",
    });
  const own = await request(core.url);
  assert.equal(own.status, 200);
  assert.equal(((await own.json()) as { ok: boolean }).ok, true);
  const foreign = await request("https://example.com");
  assert.equal(foreign.status, 403);
});

test("bad params and unknown methods fail typed, not with a 500", async () => {
  const bad = await core.dispatch("system.ping", { echo: 42 }, ctx());
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.error.code, "bad_request");
  const unknown = await core.dispatch("nope.nothing", {}, ctx());
  assert.equal(!unknown.ok && unknown.error.code, "unknown_method");
});

test("system.logs reads this home's core log", async () => {
  const file = path.join(home, "logs", "core.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ level: "error", scope: "core", msg: "channel down" })}\n`);
  const r = await new ApxClient({ url: core.url }).call("system.logs", { level: "error" });
  assert.equal(r.path, file);
  assert.deepEqual(
    r.lines.map((l) => l.msg),
    ["channel down"],
  );
});

test("refuses a non-loopback bind without a token", () => {
  assert.throws(() => assertSafeBind({ host: "0.0.0.0", token: undefined }));
  assert.doesNotThrow(() => assertSafeBind({ host: "0.0.0.0", token: "t" }));
});

function ctx() {
  const noop = () => {};
  return {
    transport: "internal" as const,
    role: "operator" as const,
    actor: "human" as const,
    session: undefined,
    log: { info: noop, warn: noop, error: noop },
  };
}
