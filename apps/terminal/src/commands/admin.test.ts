import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { consoleCommands } from "./admin.ts";

test("closing the console aborts the command still waiting on the core, and the next one runs", async () => {
  let answer = false;
  const server = http
    .createServer((req, res) => {
      req.resume();
      if (answer) res.setHeader("content-type", "application/json").end('{"ok":true,"result":{"agents":[]}}');
    })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address() as AddressInfo;
    const runner = consoleCommands(new ApxClient({ url: `http://127.0.0.1:${port}`, timeoutMs: 60_000 }));
    const started = Date.now();
    const pending = runner.run(async (client) => void (await client.call("agents.list", {})));
    await once(server, "request");
    runner.cancel();
    await assert.rejects(pending, { name: "AbortError" });
    assert.ok(Date.now() - started < 5000);

    answer = true;
    let agents: unknown;
    await runner.run(async (client) => {
      agents = (await client.call("agents.list", {})).agents;
    });
    assert.deepEqual(agents, []);
    runner.cancel();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
