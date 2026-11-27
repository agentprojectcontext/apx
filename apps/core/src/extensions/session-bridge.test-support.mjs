// Loaded before the launcher main, so this bridge fixture never contacts a package registry or provider.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const dir = process.env.MCP_REMOTE_CONFIG_DIR;
if (!dir) throw new Error("Missing isolated session folder");
const tokenDir = path.join(dir, "mcp-remote-v1");
const token = path.join(tokenDir, "00000000000000000000000000000000_tokens.json");
fs.mkdirSync(tokenDir, { recursive: true });
let complete;
const signed = new Promise((resolve) => {
  complete = resolve;
});
const callbacks = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/oauth/callback" || url.searchParams.get("state") !== "fixture-state") {
    res.writeHead(400).end();
    return;
  }
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(token, JSON.stringify({ access_token: "synthetic-session" }));
  res.end("Signed in");
  complete();
});
await new Promise((resolve) => callbacks.listen(0, "127.0.0.1", resolve));
const port = callbacks.address().port;
fs.writeFileSync(process.env.FIXTURE_CALLBACK_FILE, `http://127.0.0.1:${port}/oauth/callback?state=fixture-state`);
if (!fs.existsSync(token)) {
  const back = `http://127.0.0.1:${port}/oauth/callback`;
  process.stderr.write(
    `Please authorize this client by visiting:\nhttps://shop.example.com/authorize?state=fixture-state&redirect_uri=${encodeURIComponent(back)}\n`,
  );
  await signed;
}
const server = new McpServer({ name: "fixture-shop", version: "1.0.0" });
server.registerTool(
  "session_check",
  { description: "Read the synthetic session", annotations: { readOnlyHint: true } },
  async () => ({ content: [{ type: "text", text: fs.existsSync(token) ? "Signed in" : "Signed out" }] }),
);
await server.connect(new StdioServerTransport());
// The launcher must never continue into its real main.
await new Promise(() => {});
