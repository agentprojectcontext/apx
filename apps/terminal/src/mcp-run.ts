// `apx mcp --run <token>`: stdio MCP server bound to one agent run. External harnesses that cannot host APX
// tools in process (Codex) launch it; every call goes back to the core and runs inside that run's context.
import type { ApxClient } from "@apx/protocol/client";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export async function runRunMcp(client: ApxClient, token: string): Promise<void> {
  const server = new Server({ name: "apx", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = await client.call("harness.tools", { token });
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters as { type: "object" },
      })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const r = await client.call("harness.call", { token, tool: req.params.name, args: req.params.arguments ?? {} });
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    } catch (err) {
      return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
}
