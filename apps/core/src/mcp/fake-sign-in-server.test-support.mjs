// An MCP server that signs in through the owner's browser, like mcp-remote: until SIGNED_FILE exists it asks to sign
// in on stderr, counts the browser it would open in OPENED_LOG, and waits for the sign-in before answering.
import fs from "node:fs";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const signed = () => fs.existsSync(process.env.SIGNED_FILE ?? "");
fs.writeFileSync(`${process.env.OPENED_LOG}.pid`, String(process.pid));
if (!signed()) {
  fs.appendFileSync(process.env.OPENED_LOG ?? "", "opened\n");
  // CALLBACK: like mcp-remote, the page returns to a port on this machine, which signs it in.
  let page = "https://shop.example.com/authorize?state=1";
  if (process.env.CALLBACK) {
    const back = http.createServer((req, res) => {
      const got = new URL(req.url ?? "/", "http://localhost");
      const ok = got.pathname === "/oauth/callback" && got.searchParams.get("state") === "s-42";
      if (ok) fs.writeFileSync(process.env.SIGNED_FILE ?? "", "ok");
      res.writeHead(ok ? 200 : 404).end(ok ? "signed in" : "no");
    });
    await new Promise((r) => back.listen(0, "127.0.0.1", r));
    const port = back.address().port;
    page = `https://shop.example.com/authorize?state=s-42&redirect_uri=${encodeURIComponent(`http://localhost:${port}/oauth/callback`)}`;
  }
  process.stderr.write(`\nPlease authorize this client by visiting:\n${page}\n\n`);
  // Like a sign-in that ran out of time: the page it opened answers nobody now.
  if (process.env.GIVE_UP) process.exit(1);
  while (!signed()) await new Promise((r) => setTimeout(r, 50));
}
const server = new McpServer({ name: "shop", version: "1.0.0" });
server.registerTool(
  "echo",
  { description: "Echo text", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
  async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
);
await server.connect(new StdioServerTransport());
