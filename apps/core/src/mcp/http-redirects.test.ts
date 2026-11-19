import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const KEY = "synthetic-redirect-secret";
type Received = { key: string | string[] | undefined; body: string };

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

for (const status of [301, 302, 303, 307, 308]) {
  test(`a ${status} MCP redirect cannot send a stored API key or request body to another origin`, async () => {
    const received: Received[] = [];
    const destination = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      received.push({ key: req.headers["x-api-key"], body });
      res.writeHead(400, { "content-type": "application/json" });
      res.end("{}");
    });
    const target = await listen(destination);
    const source = http.createServer((req, res) => {
      req.resume();
      res.writeHead(status, { location: `${target}/capture/${encodeURIComponent(String(req.headers["x-api-key"]))}` });
      res.end();
    });
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    try {
      const origin = await listen(source);
      await env.client.call("secrets.set", { name: "redirect_key", value: KEY });
      await env.client.call("mcp.set", {
        name: "redirect",
        server: { url: `${origin}/mcp`, headers: { "x-api-key": "secret://redirect_key" } },
      });
      const result = await env.client.call("mcp.test", { scope: "global", server: "redirect" });
      assert.equal(result.ok, false);
      assert.deepEqual(received, [], "the redirect target must not receive even a credential-free request");
      assert.ok(!JSON.stringify(result).includes(KEY), "the connection error cannot expose the credential");
    } finally {
      await env.core.close();
      await env.cleanup();
      await close(source);
      await close(destination);
    }
  });
}

for (const status of [301, 302, 303]) {
  test(`a ${status} MCP redirect within the approved origin cannot turn a POST into a GET`, async () => {
    const received: Received[] = [];
    const server = http.createServer(async (req, res) => {
      if (req.url === "/redirect") {
        req.resume();
        res.writeHead(status, { location: "/capture" });
        return res.end();
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      received.push({ key: req.headers["x-api-key"], body });
      res.writeHead(400, { "content-type": "application/json" });
      res.end("{}");
    });
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    try {
      const origin = await listen(server);
      await env.client.call("secrets.set", { name: "redirect_key", value: KEY });
      await env.client.call("mcp.set", {
        name: "redirect",
        server: { url: `${origin}/redirect`, headers: { "x-api-key": "secret://redirect_key" } },
      });
      const result = await env.client.call("mcp.test", { scope: "global", server: "redirect" });
      assert.equal(result.ok, false);
      assert.deepEqual(received, [], "a method-changing redirect must not reach the target within the same origin");
      assert.ok(!JSON.stringify(result).includes(KEY), "the connection error cannot expose the credential");
    } finally {
      await env.core.close();
      await env.cleanup();
      await close(server);
    }
  });
}

for (const status of [307, 308]) {
  test(`a ${status} MCP redirect within the approved origin still connects with its stored API key`, async () => {
    const received: Received[] = [];
    const server = http.createServer(async (req, res) => {
      if (req.url === "/redirect") {
        req.resume();
        res.writeHead(status, { location: "/mcp" });
        return res.end();
      }
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end();
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      received.push({ key: req.headers["x-api-key"], body });
      const message = JSON.parse(body) as { id?: number; method: string; params?: { protocolVersion: string } };
      if (message.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result:
            message.method === "initialize"
              ? {
                  protocolVersion: message.params?.protocolVersion,
                  capabilities: { tools: {} },
                  serverInfo: { name: "Acme", version: "1.0.0" },
                }
              : { tools: [] },
        }),
      );
    });
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    try {
      const origin = await listen(server);
      await env.client.call("secrets.set", { name: "redirect_key", value: KEY });
      await env.client.call("mcp.set", {
        name: "redirect",
        server: { url: `${origin}/redirect`, headers: { "x-api-key": "secret://redirect_key" } },
      });
      const result = await env.client.call("mcp.test", { scope: "global", server: "redirect" });
      assert.equal(result.ok, true, result.error);
      assert.ok(received.some((request) => request.body.includes('"initialize"')));
      assert.ok(received.some((request) => request.body.includes('"tools/list"')));
      assert.ok(received.every((request) => request.key === KEY));
    } finally {
      await env.core.close();
      await env.cleanup();
      await close(server);
    }
  });
}
