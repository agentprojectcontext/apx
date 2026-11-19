import assert from "node:assert/strict";
import { test } from "node:test";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const cases = [
  {
    name: "default-port HTTPS upgrade",
    from: "http://acme.example/mcp",
    to: "https://acme.example/mcp",
    allowed: true,
  },
  {
    name: "explicit default-port HTTPS upgrade",
    from: "http://acme.example:80/mcp",
    to: "https://acme.example:443/mcp",
    allowed: true,
  },
  { name: "HTTPS downgrade", from: "https://acme.example/mcp", to: "http://acme.example/mcp", allowed: false },
  {
    name: "nondefault source port",
    from: "http://acme.example:8080/mcp",
    to: "https://acme.example/mcp",
    allowed: false,
  },
  {
    name: "nondefault target port",
    from: "http://acme.example/mcp",
    to: "https://acme.example:8443/mcp",
    allowed: false,
  },
  { name: "different hostname", from: "http://acme.example/mcp", to: "https://northwind.example/mcp", allowed: false },
];

for (const { name, from, to, allowed } of cases) {
  test(`MCP redirect policy ${allowed ? "permits" : "blocks"}: ${name}`, async () => {
    const requests: { url: string; method: string | undefined; key: string | null; body: RequestInit["body"] }[] = [];
    const transport = new StreamableHTTPClientTransport(new URL(from), {
      requestInit: { headers: { "x-api-key": "synthetic-upgrade-secret" } },
      fetch: async (input, init) => {
        requests.push({
          url: input instanceof Request ? input.url : String(input),
          method: init?.method,
          key: new Headers(init?.headers).get("x-api-key"),
          body: init?.body,
        });
        return requests.length === 1
          ? new Response(null, { status: 307, headers: { location: to } })
          : new Response(null, { status: 202 });
      },
    });
    const notification = { jsonrpc: "2.0" as const, method: "notifications/cancelled", params: { requestId: 1 } };
    try {
      await transport.start();
      if (allowed) {
        await transport.send(notification);
        assert.deepEqual(
          requests.map((request) => request.url),
          [new URL(from).href, new URL(to).href],
        );
        assert.ok(requests.every((request) => request.method === "POST"));
        assert.ok(requests.every((request) => request.key === "synthetic-upgrade-secret"));
        assert.ok(requests.every((request) => request.body === JSON.stringify(notification)));
      } else {
        await assert.rejects(transport.send(notification), /Redirect.*not followed/);
        assert.deepEqual(
          requests.map((request) => request.url),
          [new URL(from).href],
        );
      }
    } finally {
      await transport.close();
    }
  });
}
