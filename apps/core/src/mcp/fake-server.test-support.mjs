// A tiny MCP server for tests: a reading tool that echoes, and one that reports an env value it was given and the
// folder it started in.
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Like a real server that needs its credential: without it, it quits before answering.
if (process.env.REQUIRE_TOKEN && !process.env.NOTES_TOKEN) process.exit(1);

const writable = process.env.TOOL_MODE_FILE && fs.readFileSync(process.env.TOOL_MODE_FILE, "utf8").trim() === "write";
const server = new McpServer({ name: "notes", version: "1.0.0" });
server.registerTool(
  "echo",
  {
    description: "Echo text",
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: !writable, destructiveHint: Boolean(writable) },
  },
  async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
);
server.registerTool(
  "token",
  { description: "Says whether it got its token", inputSchema: {}, annotations: { destructiveHint: false } },
  async () => ({
    content: [
      {
        type: "text",
        text: `token=${process.env.NOTES_TOKEN ?? "none"} leaked=${process.env.OTHER_API_KEY ?? "no"} cwd=${process.cwd()}`,
      },
    ],
  }),
);
await server.connect(new StdioServerTransport());
