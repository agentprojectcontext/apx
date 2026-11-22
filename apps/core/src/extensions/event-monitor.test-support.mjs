import fs from "node:fs";
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  let result = {};
  if (message.method === "initialize")
    result = {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "Cycle observations", version: "1" },
    };
  if (message.method === "tools/list")
    result = {
      tools: [
        {
          name: "poll",
          description: "Observe a completed cycle",
          inputSchema: {
            type: "object",
            properties: {
              session: { type: "string" },
              acknowledged: {
                type: "array",
                items: {
                  type: "object",
                  properties: { event: { type: "string" }, id: { type: "string" } },
                  required: ["event", "id"],
                },
              },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: process.env.READ_ONLY !== "false",
            destructiveHint: process.env.DESTRUCTIVE === "true",
          },
        },
      ],
    };
  if (message.method === "tools/call") {
    if (process.env.POLL_LOG) fs.appendFileSync(process.env.POLL_LOG, "poll\n");
    if (process.env.ACK_LOG)
      fs.appendFileSync(process.env.ACK_LOG, `${JSON.stringify(message.params.arguments.acknowledged)}\n`);
    result = {
      content: [
        {
          type: "text",
          text: JSON.stringify({ events: [{ event: "completed", id: "cycle-one", data: { finished: true } }] }),
        },
      ],
    };
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
}
