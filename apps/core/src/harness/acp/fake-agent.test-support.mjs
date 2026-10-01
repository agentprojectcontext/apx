// A tiny ACP agent for tests: offers two models, asks permission to edit, reports a tool call and answers.
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
const out = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
let model = "m1";
let nextId = 1000;
const waiting = new Map();
const ask = (method, params) =>
  new Promise((res) => {
    const id = ++nextId;
    waiting.set(id, res);
    out({ id, method, params });
  });
const update = (sessionId, update) => out({ method: "session/update", params: { sessionId, update } });
rl.on("line", async (line) => {
  const m = JSON.parse(line);
  if (m.id !== undefined && !m.method) return waiting.get(m.id)?.(m.result);
  if (m.method === "initialize")
    return out({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  if (m.method === "session/new" || m.method === "session/load")
    return out({
      id: m.id,
      result: {
        sessionId: m.params.sessionId ?? "fake-session-1",
        configOptions: [
          {
            id: "model",
            category: "model",
            currentValue: model,
            options: [
              { value: "m1", name: "M1" },
              { value: "m2", name: "M2" },
            ],
          },
        ],
      },
    });
  if (m.method === "session/set_config_option") {
    model = m.params.value;
    return out({ id: m.id, result: {} });
  }
  if (m.method === "session/prompt") {
    const sid = m.params.sessionId;
    const text = m.params.prompt[0].text;
    update(sid, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Edit notes.md",
      kind: "edit",
      status: "pending",
    });
    const perm = await ask("session/request_permission", {
      sessionId: sid,
      toolCall: { toolCallId: "t1", title: "Edit notes.md", kind: "edit" },
      options: [
        { optionId: "yes", kind: "allow_once", name: "Allow" },
        { optionId: "no", kind: "reject_once", name: "Reject" },
      ],
    });
    const allowed = perm?.outcome?.optionId === "yes";
    update(sid, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: allowed ? "completed" : "failed" });
    const hasInstructions = text.includes("<apx_instructions>");
    update(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `model=${model} ` } });
    update(sid, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `edit=${allowed ? "allowed" : "rejected"} instructions=${hasInstructions}` },
    });
    return out({ id: m.id, result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } } });
  }
  if (m.id !== undefined) out({ id: m.id, error: { code: -32601, message: "no" } });
});
