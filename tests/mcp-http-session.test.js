import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { makeTempProject, cleanupTempProject } from "./_helpers.js";
import { McpRegistry } from "#core/mcp/runner.js";

function startMcpHttpServer() {
  const requests = [];
  const sessionId = "test-session-123";

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({
        method: body.method,
        sessionId: req.headers["mcp-session-id"] || null,
        authorization: req.headers.authorization || null,
      });

      res.setHeader("Content-Type", "application/json");
      if (body.method === "initialize") {
        res.setHeader("Mcp-Session-Id", sessionId);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "test", version: "1.0.0" },
          },
        }));
        return;
      }

      if (body.method === "notifications/initialized") {
        if (req.headers["mcp-session-id"] !== sessionId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "missing session" } }));
          return;
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", result: {} }));
        return;
      }

      if (body.method === "tools/list") {
        if (req.headers["mcp-session-id"] !== sessionId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "missing session" } }));
          return;
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: "unknown method" }));
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.on("error", reject);
  });
}

test("HTTP MCP client reuses initialize session id and redacts debug headers", async () => {
  const fake = await startMcpHttpServer();
  const root = makeTempProject({
    mcps: {
      remote: {
        url: fake.url,
        headers: {
          Authorization: "Bearer secret-token",
          "X-Trace": "visible",
        },
        enabled: true,
      },
    },
  });
  const registry = new McpRegistry({ projectPath: root });

  try {
    const result = await registry.listTools("remote");
    assert.deepEqual(result, { tools: [] });

    assert.deepEqual(
      fake.requests.map((r) => [r.method, r.sessionId]),
      [
        ["initialize", null],
        ["notifications/initialized", "test-session-123"],
        ["tools/list", "test-session-123"],
      ]
    );

    const logs = registry.getLogs("remote");
    const joined = logs.events.map((e) => e.msg).join("\n");
    assert.match(joined, /"Authorization":"\[redacted\]"/);
    assert.match(joined, /"X-Trace":"visible"/);
    assert.doesNotMatch(joined, /secret-token/);
  } finally {
    registry.shutdown();
    cleanupTempProject(root);
    await fake.close();
  }
});
