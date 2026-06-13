---
name: apx-mcp-builder
scope: internal
description: Author a new MCP (Model Context Protocol) server and register it in APX. Covers JSON-RPC stdio protocol, FastMCP (Python) / TypeScript SDK shapes, tool design, secrets, debugging. Load when building a new MCP / exposing a new tool surface. To add an existing MCP, load `apx-mcp` instead.
---

# apx-mcp-builder

An MCP server is a tiny stdio JSON-RPC process. APX spawns it (via `apx mcp add`), discovers tools (`tools/list`), and lets the super-agent call them by name.

## Minimum surface

| Method | Purpose | Returns |
|---|---|---|
| `initialize` | Handshake (protocol version + capabilities). | Server capabilities. |
| `tools/list` | Enumerate tools. | `{ tools: [{name, description, inputSchema}] }` |
| `tools/call` | Run one tool with `{ name, arguments }`. | `{ content: [...], isError? }` |
| `notifications/initialized` | One-way init-done from APX. | — |

JSON-RPC 2.0 over stdio, framed `Content-Length: N\r\n\r\n<JSON>`. The `@modelcontextprotocol/sdk` (TS) and `fastmcp` / `mcp` (Python) packages handle framing.

## Pick a stack

| Stack | When |
|---|---|
| **Python + FastMCP** | Fastest path; decorator-based; ideal for pip-wrapping tools. |
| **Node + @modelcontextprotocol/sdk** | Node-only libs, or zero install (`npx -y`). |
| Raw JSON-RPC | Only when exposing an existing daemon. Otherwise use the SDK. |

## Python (FastMCP) — minimum viable server

```python
# my_server.py
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def search_inventory(query: str, limit: int = 10) -> list[dict]:
    """Search the inventory by free-text query. Returns matching SKUs."""
    return [{"sku": "abc", "title": "..."}]

@mcp.tool()
def get_stock(sku: str) -> dict:
    """Return the current stock count for a SKU."""
    return {"sku": sku, "stock": 42}

if __name__ == "__main__":
    mcp.run()  # stdio transport
```

```bash
pip install fastmcp
# or: uv tool install fastmcp

apx mcp add my-server \
  --command uv --project iacrmar \
  -- run python /abs/path/my_server.py
```

## Node (TypeScript SDK) — minimum viable server

```typescript
// my-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "my-server", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_inventory",
      description: "Search the inventory by free-text query.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 10 },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "search_inventory") {
    const { query, limit = 10 } = req.params.arguments as any;
    return {
      content: [{ type: "text", text: JSON.stringify([{ sku: "abc" }]) }],
    };
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});

await server.connect(new StdioServerTransport());
```

```bash
apx mcp add my-server \
  --command npx --project iacrmar \
  -- -y my-server-package
```

## Tool design rules

1. **Names are snake_case verbs**: `search_inventory`, not `inventorySearch`.
2. **inputSchema is JSON Schema draft-07**. `required` matters — vague schemas → bad calls.
3. **Descriptions read like a man-page**. Tool + param descriptions are surfaced to the model.
4. **Return structured data**, not prose. Convention: JSON inside a text content block. Images use the `image` type.
5. **Errors are errors**: `throw new Error(...)` propagates as `isError: true`. Empty result = "found nothing" — different signal.

## Env vars and secrets

```bash
apx mcp add github \
  --scope runtime --project iacrmar \
  --command npx \
  --env GITHUB_TOKEN=ghp_xxx \
  --env GITHUB_OWNER=manuel \
  -- -y @modelcontextprotocol/server-github
```

`--scope runtime` writes to `~/.apx/projects/<id>/mcps.json` (chmod 0600, never committed). NEVER `--scope shared` for tokens — that file lives in `.apc/` and gets committed.

## Anti-examples

```python
# DON'T expose every internal function. A server with 40 tools eats context.
# Pick 5-10 high-value tools per server; split into multiple servers if more.

# DON'T return giant blobs in `content`. The agent re-reads every turn.
# Paginate (`offset`, `limit`) and let the agent ask for more.

# DON'T mix stdio + HTTP transports in one process. APX spawns stdio;
# for HTTP use `url:` in mcps.json instead of `command:`.

# DON'T print to stdout outside JSON-RPC frames. Stray print() corrupts
# the protocol — use stderr for logs. (SDKs handle this; bare `print("debug")`
# in a tool body breaks everything.)
```

## Debugging

```bash
# Smoke test (apx mcp tools is a v0.2 stub — don't rely on it)
apx mcp run my-server search_inventory '{"query":"shoes"}'

# Spawn errors / stderr
apx log -f

# Scopes / files / env APX sees
apx mcp check --project iacrmar
```

## Don't

- Don't reinvent SDK framing — bypass only with reason.
- Don't make interactive tools. MCP is one-shot per call; split flows into multiple tools.
- Don't ship without a README — future-you forgets which env vars matter.
- Don't expect APX to retry MCP errors. The agent sees the error and decides.
