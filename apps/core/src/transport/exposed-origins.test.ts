import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { testConfig } from "../config.ts";
import { createCore } from "../server.ts";
import { exposedOrigins } from "../server-wiring.ts";
import { removeDir } from "../testkit/platform.ts";

const PUBLIC = "https://apx.example.ts.net";
let core: Awaited<ReturnType<typeof createCore>>;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-origins-"));

before(async () => {
  core = await createCore(testConfig({ home, publicUrl: PUBLIC }), { quiet: true });
});
after(async () => {
  await core.close();
  await removeDir(home);
});

const rpc = (origin: string) =>
  fetch(`${core.url}/rpc/system.ping`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{}",
  });

test("the panel opened at the core's public URL may call it; a foreign page still may not", async () => {
  assert.equal((await rpc(PUBLIC)).status, 200);
  assert.equal((await rpc("https://evil.example")).status, 403);
});

test("bound beyond loopback, every network address the core answers on is an allowed origin", () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .flatMap((a) => (a && !a.internal && a.family === "IPv4" ? [`http://${a.address}:7440`] : []));
  const origins = exposedOrigins({ host: "0.0.0.0", publicUrl: `${PUBLIC}` }, 7440);
  assert.equal(origins[0], PUBLIC);
  for (const u of lan) assert.ok(origins.includes(u), u);
  assert.deepEqual(exposedOrigins({ host: "10.0.0.5", publicUrl: undefined }, 7440), ["http://10.0.0.5:7440"]);
  assert.deepEqual(exposedOrigins({ host: "127.0.0.1", publicUrl: "not a url" }, 7440), []);
});
