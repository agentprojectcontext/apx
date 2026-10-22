import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { admin, consoleCommands } from "./admin.ts";

for (const result of [
  { ok: false, restart: false, log: "unpacking bundle: spawn tar ENOENT" },
  { ok: true, restart: false, log: "installed" },
  { ok: true, restart: true, log: "installed" },
]) {
  test(`upgrade output matches ok=${result.ok} restart=${result.restart}`, async (t) => {
    const lines: string[] = [];
    t.mock.method(console, "log", (line: string) => lines.push(line));
    const previousExitCode = process.exitCode;
    const server = http
      .createServer((req, res) => {
        req.resume();
        const response = req.url?.endsWith("system.updates")
          ? { source: "release", behind: 1, latest: "2.1.0", changes: [] }
          : result;
        res.setHeader("content-type", "application/json").end(JSON.stringify({ ok: true, result: response }));
      })
      .listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address() as AddressInfo;
      const client = new ApxClient({ url: `http://127.0.0.1:${port}` });
      await admin(client, "upgrade", [], {});
      const output = lines.join("\n");
      assert.match(output, result.ok ? /Updated/ : /Update failed/);
      assert.match(output, new RegExp(result.log));
      if (!result.ok) {
        assert.doesNotMatch(output, /Restart APX|Core restarting/);
        assert.equal(process.exitCode, 1);
      } else {
        assert.match(output, result.restart ? /Core restarting/ : /Restart APX to load the update/);
        assert.equal(process.exitCode, previousExitCode);
      }
    } finally {
      process.exitCode = previousExitCode;
      server.closeAllConnections();
      server.close();
    }
  });
}

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
