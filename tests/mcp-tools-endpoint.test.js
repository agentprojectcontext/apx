// GET /projects/:pid/mcps/:name/tools — full tool catalog for `apx mcp tools`,
// plus nextCursor pagination merging in the registry's listTools.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";

import { makeTempProject, cleanupTempProject } from "./_helpers.js";
import { McpRegistry } from "#core/mcp/runner.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test("GET /projects/:pid/mcps/:name/tools returns the tool catalog", async () => {
  const app = express();
  app.use(express.json());
  const { register } = await import("../src/host/daemon/api/mcps.js");
  register(app, {
    projects: { rebuild: () => {} },
    project: () => ({ id: "p1", path: "/tmp/none", storagePath: null }),
    registries: {
      shutdown: () => {},
      for: () => ({
        listTools: async (name) => {
          assert.equal(name, "dokploy");
          return {
            tools: [
              {
                name: "project-all",
                description: "List all projects",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          };
        },
      }),
    },
  });

  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/projects/p1/mcps/dokploy/tools`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].name, "project-all");
    assert.deepEqual(body.tools[0].inputSchema, { type: "object", properties: {} });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /projects/:pid/mcps/:name/tools surfaces spawn errors as 500", async () => {
  const app = express();
  app.use(express.json());
  const { register } = await import("../src/host/daemon/api/mcps.js");
  register(app, {
    projects: { rebuild: () => {} },
    project: () => ({ id: "p1", path: "/tmp/none", storagePath: null }),
    registries: {
      shutdown: () => {},
      for: () => ({
        listTools: async () => {
          throw new Error('MCP "broken" exited with code 1. stderr: ENOENT');
        },
      }),
    },
  });

  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/projects/p1/mcps/broken/tools`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.match(body.error, /exited with code 1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Paginated tools/list: the registry must follow nextCursor and hand back a
// single merged catalog.
function startPaginatedMcpServer() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      res.setHeader("Content-Type", "application/json");
      if (body.method === "initialize") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "paginated", version: "1.0.0" },
          },
        }));
        return;
      }
      if (body.method === "notifications/initialized") {
        res.end(JSON.stringify({ jsonrpc: "2.0", result: {} }));
        return;
      }
      if (body.method === "tools/list") {
        const cursor = body.params?.cursor;
        const result = cursor === "page2"
          ? { tools: [{ name: "tool-b", description: "second page" }] }
          : { tools: [{ name: "tool-a", description: "first page" }], nextCursor: "page2" };
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
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
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.on("error", reject);
  });
}

test("registry listTools follows nextCursor and merges pages", async () => {
  const fake = await startPaginatedMcpServer();
  const root = makeTempProject({
    mcps: { paginated: { url: fake.url, enabled: true } },
  });
  const registry = new McpRegistry({ projectPath: root });

  try {
    const result = await registry.listTools("paginated");
    assert.deepEqual(result.tools.map((t) => t.name), ["tool-a", "tool-b"]);
  } finally {
    registry.shutdown();
    cleanupTempProject(root);
    await fake.close();
  }
});
