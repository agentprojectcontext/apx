import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createLog } from "../log.ts";
import { createRouter, type Handlers } from "../rpc/router.ts";
import { httpHandler } from "./http.ts";

test("RPC rejects malicious arrays with bounded errors and continues serving ping", async () => {
  let entered = 0;
  const dispatch = createRouter(
    new Proxy<Partial<Handlers>>(
      {
        "mcp.set": () => {
          entered++;
          throw new Error("invalid params reached handler");
        },
        "agents.install": () => {
          entered++;
          throw new Error("invalid params reached handler");
        },
        "system.ping": ({ echo }) => ({ pong: echo ?? "pong", at: new Date(0).toISOString() }),
      },
      {},
    ) as Handlers,
  );
  const server = createServer(
    httpHandler(dispatch, createLog("test", true), { allowedOrigins: new Set(), token: undefined }),
  );
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/rpc/`;
    const invalid = Array.from({ length: 100_000 }, () => null);
    const payloads = [
      ["mcp.set", { name: "test", server: { command: "unused", args: invalid } }],
      ["agents.install", { templates: invalid }],
    ] as const;
    for (const [method, params] of payloads) {
      const body = JSON.stringify(params);
      assert.ok(Buffer.byteLength(body) < 1024 * 1024, "payload must fit the normal HTTP limit");
      const response = await fetch(`${url}${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "invalid-array" },
        body,
      });
      assert.equal(response.status, 400);
      const text = await response.text();
      assert.ok(Buffer.byteLength(text) < 1024, "invalid-array errors must stay bounded");
      assert.deepEqual(JSON.parse(text), {
        ok: false,
        error: { code: "bad_request", message: "invalid params" },
      });
      assert.equal(entered, 0);
      const ping = await fetch(`${url}system.ping`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ echo: "still responsive" }),
      });
      assert.equal(ping.status, 200);
      assert.deepEqual(await ping.json(), {
        ok: true,
        result: { pong: "still responsive", at: new Date(0).toISOString() },
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
