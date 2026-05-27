---
name: apx-mcp-builder
scope: internal
description: How to build a Model Context Protocol (MCP) server from scratch and wire it into APX. Load when the user asks "creame un MCP server", "necesito una herramienta para X", or you need to expose a new tool surface to agents. Covers the JSON-RPC stdio protocol, FastMCP Python / TypeScript SDK shapes, and APX-specific registration.
---

# apx-mcp-builder

A **Model Context Protocol** server is a tiny process the agent talks to over stdio JSON-RPC. APX spawns it (via `apx mcp add`), discovers its tools (`tools/list`), and lets the super-agent call them by name. This skill is for **authoring a new MCP server**. To **add an existing one** to APX, load `apx-mcp` instead.

## The minimum surface

An MCP server must implement four RPC methods:

| Method | Purpose | Returns |
|---|---|---|
| `initialize` | Handshake. APX sends protocol version + capabilities. | Server's capabilities. |
| `tools/list` | Enumerate available tools. | `{ tools: [{name, description, inputSchema}] }` |
| `tools/call` | Run one tool. APX sends `{ name, arguments }`. | `{ content: [...], isError? }` |
| `notifications/initialized` | One-way; APX signals it's done initializing. | — |

JSON-RPC 2.0 framing over stdio. Each message: `Content-Length: N\r\n\r\n<JSON>`. The `@modelcontextprotocol/sdk` (TS) and `fastmcp` / `mcp` (Python) packages handle framing for you.

## Pick a stack

| Stack | When |
|---|---|
| **Python + FastMCP** | Fastest path. Decorator-based. Great if your tools wrap pip libs. |
| **Node + @modelcontextprotocol/sdk** | When the tool calls Node-only libs, or you want zero install (`npx -y`). |
| Raw JSON-RPC | Only if you have an existing daemon you want to expose. Otherwise SDK. |

## Python (FastMCP) — minimum viable server

```python
# my_server.py
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def search_inventory(query: str, limit: int = 10) -> list[dict]:
    """Search the inventory by free-text query. Returns matching SKUs."""
    # ... your logic ...
    return [{"sku": "abc", "title": "..."}]

@mcp.tool()
def get_stock(sku: str) -> dict:
    """Return the current stock count for a SKU."""
    return {"sku": sku, "stock": 42}

if __name__ == "__main__":
    mcp.run()  # stdio transport by default
```

Install:
```bash
pip install fastmcp
# or via uv (recommended):
uv tool install fastmcp
```

Register in APX:
```bash
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
    // ... your logic ...
    return {
      content: [{ type: "text", text: JSON.stringify([{ sku: "abc" }]) }],
    };
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});

await server.connect(new StdioServerTransport());
```

Register:
```bash
apx mcp add my-server \
  --command npx --project iacrmar \
  -- -y my-server-package
```

## Tool design rules

1. **Names are snake_case**, verbs preferred: `search_inventory`, not `inventorySearch`.
2. **inputSchema is JSON Schema draft-07**. Be strict: `required` matters. The agent reads the schema; vague schemas → bad calls.
3. **Descriptions read like a CLI man-page**. Each tool's description and each param's description gets surfaced to the model. Make them count.
4. **Return structured data**, not prose. MCP `content` can be text but the convention is to put JSON inside a text block so the agent can parse it back. For images, use the `image` content type.
5. **Errors are errors, not silent empty**. `throw new Error(...)` propagates as `isError: true` and the agent will see it. Empty results = "found nothing"; that's a different signal.

## Env vars and secrets

Pass them at registration time via `--env`:

```bash
apx mcp add github \
  --scope runtime --project iacrmar \
  --command npx \
  --env GITHUB_TOKEN=ghp_xxx \
  --env GITHUB_OWNER=manuel \
  -- -y @modelcontextprotocol/server-github
```

`--scope runtime` writes to `~/.apx/projects/<id>/mcps.json` (chmod 0600, never committed). NEVER use `--scope shared` for tokens — that file lives in `.apc/` and gets committed.

## Anti-examples

```python
# DON'T expose every internal function as a tool.
# A server with 40 tools is a context budget killer. Pick 5-10 high-value
# tools per server; split into multiple servers if you have more.

# DON'T return giant blobs in `content`. The agent has to read all of it
# every turn. Paginate (`offset`, `limit`) and let the agent ask for more.

# DON'T mix stdio + HTTP transports in the same process. Pick one. APX
# spawns stdio servers; if you want HTTP, use `url:` in mcps.json instead
# of `command:`.

# DON'T print to stdout other than JSON-RPC frames. Any stray print()
# corrupts the protocol — use stderr for logs. (FastMCP / the SDK handle
# this for you, but `print("debug")` in a tool body breaks everything.)
```

## Common debugging path

```bash
# 1. Does the server start?
apx mcp tools my-server                # forces a spawn + tools/list

# 2. Are there spawn errors?
apx log -f                              # tail the daemon log — stderr lands here

# 3. Does a tool work in isolation?
apx mcp run my-server search_inventory '{"query":"shoes"}'

# 4. Are env vars set?
apx mcp check --project iacrmar
```

## Don't

- Don't reinvent the SDK framing. FastMCP / @modelcontextprotocol/sdk handle the stdio JSON-RPC dance — bypass only if you really need to.
- Don't make tools that require interactive input. MCP is one-shot per call. If you need a flow, design separate tools for each step.
- Don't ship a server without a README in the repo. Future-you will not remember which env vars matter.
- Don't expect APX to retry MCP errors automatically. The agent sees the error and decides.
