// A dependency-free MCP server over stdio (one JSON-RPC message per line). Copy it into an extension's folder, change
// TOOLS, and name it in apx-extension.json: "mcp": { "tools": { "command": "node", "args": ["./server.mjs"] } }.
// Write logs to stderr only: stdout carries the protocol.
import { createInterface } from "node:readline";

const TOOLS = {
  word_count: {
    description: "Count the words in a text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "the text to count" } },
      required: ["text"],
    },
    async run({ text }) {
      return String(String(text).trim().split(/\s+/).filter(Boolean).length);
    },
  },
  // A tool that calls an HTTP API with a key the owner typed once (declared under "secrets" in the manifest and given
  // to the server as "env": { "API_KEY": "secret://api_key" }):
  // lookup: {
  //   description: "Look up a customer by email.",
  //   inputSchema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
  //   async run({ email }) {
  //     const r = await fetch(`https://api.example.com/customers?email=${encodeURIComponent(email)}`, {
  //       headers: { authorization: `Bearer ${process.env.API_KEY}` },
  //     });
  //     if (!r.ok) throw new Error(`the API answered ${r.status}`);
  //     return JSON.stringify(await r.json());
  //   },
  // },
};

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

async function handle({ id, method, params }) {
  if (method === "initialize")
    return {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "extension-tools", version: "1.0.0" },
    };
  if (method === "ping") return {};
  if (method === "tools/list")
    return {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  if (method === "tools/call") {
    const tool = TOOLS[params?.name];
    if (!tool) throw Object.assign(new Error(`unknown tool ${params?.name}`), { code: -32602 });
    try {
      return { content: [{ type: "text", text: await tool.run(params.arguments ?? {}) }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err?.message ?? err) }], isError: true };
    }
  }
  if (id === undefined) return undefined;
  throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: "parse error" } });
  }
  try {
    const result = await handle(message);
    if (message.id !== undefined && result !== undefined) send({ id: message.id, result });
  } catch (err) {
    if (message.id !== undefined) send({ id: message.id, error: { code: err.code ?? -32603, message: err.message } });
  }
});
