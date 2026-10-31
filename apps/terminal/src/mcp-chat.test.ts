import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { recordingClient } from "./commands/testing.ts";
import { registerChatTools } from "./mcp-chat.ts";

async function tools(t: TestContext, answers: Record<string, unknown>) {
  const recorded = recordingClient(answers);
  const server = new McpServer({ name: "apx-test", version: "1" });
  registerChatTools(server, recorded.client);
  const client = new Client({ name: "outside-app", version: "1" });
  const [outside, inside] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(inside);
  await client.connect(outside);
  return { ...recorded, invoke: (name: string, args = {}) => client.callTool({ name, arguments: args }) };
}

test("outside-app MCP lists agents through the protocol and explains an empty crew", async (t) => {
  for (const agents of [
    [],
    [
      {
        id: "superagent",
        name: "Roby",
        role: "Builder",
        project_id: "acme",
        scope: "project",
        project_name: "Acme",
        project_orchestrator: null,
        is_orchestrator: false,
      },
    ],
  ]) {
    const { invoke, calls } = await tools(t, { "agents.list": { agents } });
    const result = await invoke("apx_agents");
    assert.deepEqual(result.content, [
      {
        type: "text",
        text: agents.length
          ? "- superagent: Roby — Builder [Project: Acme (id: acme)] · Orchestrator: none · Is orchestrator: no"
          : "no agents",
      },
    ]);
    assert.equal(result.isError, false);
    assert.deepEqual(calls, [["agents.list", {}]]);
  }
});

test("outside-app MCP distinguishes global agents and resolved project orchestrators", async (t) => {
  const { invoke } = await tools(t, {
    "agents.list": {
      agents: [
        {
          id: "global",
          name: "Assistant",
          scope: "global",
          project_name: null,
          project_orchestrator: null,
          is_orchestrator: false,
        },
        {
          id: "lead",
          name: "Lead",
          project_id: "acme",
          project_name: "Acme",
          scope: "project",
          project_orchestrator: { id: "lead", name: "Lead", selection: "marked" },
          is_orchestrator: true,
        },
      ],
    },
  });
  const result = await invoke("apx_agents");
  assert.deepEqual(result.content, [
    {
      type: "text",
      text:
        "- global: Assistant [Global: no fixed project] · Orchestrator: not applicable · Is orchestrator: no\n" +
        "- lead: Lead [Project: Acme (id: acme)] · Orchestrator: Lead (id: lead, Explicit mark) · Is orchestrator: yes",
    },
  ]);
});

test("outside-app MCP creates a loose chat, sends the question and returns only that run's agent answer", async (t) => {
  const { invoke, calls } = await tools(t, {
    "threads.create": { id: "new-chat" },
    "threads.send": { run: { id: "run-1" } },
    "threads.get": {
      runs: [{ id: "run-1", state: "completed", end_reason: "step_limit" }],
      messages: [
        {
          run_id: "previous",
          author: { kind: "agent", id: "superagent" },
          parts: [{ type: "text", text: "Old answer" }],
        },
        { run_id: "run-1", author: { kind: "user" }, parts: [{ type: "text", text: "Question" }] },
        {
          run_id: "run-1",
          author: { kind: "agent", id: "superagent" },
          parts: [{ type: "text", text: "Progress" }, { type: "file" }, { type: "text", text: "Next step" }],
        },
      ],
    },
  });
  const result = await invoke("apx_ask", { agent: "superagent", text: "Build this" });
  assert.deepEqual(result.content, [
    {
      type: "text",
      text: "(It ran out of steps: a progress report, not a final result.)\nProgress\nNext step\n\n(thread new-chat)",
    },
  ]);
  assert.deepEqual(calls, [
    ["threads.create", { kind: "loose", agent_id: "superagent" }],
    ["threads.send", { thread: "new-chat", text: "Build this" }],
    ["threads.get", { thread: "new-chat" }],
  ]);
});

test("outside-app MCP continues a chat and distinguishes approval, failure, cancellation and an empty answer", async (t) => {
  for (const [state, expected] of [
    ["input-required", "Waiting for the owner to approve something in APX (thread existing)."],
    ["failed", "The run failed: Model unavailable"],
    ["canceled", "The run canceled: Model unavailable"],
    ["completed", "(no answer)"],
  ]) {
    const { invoke, calls } = await tools(t, {
      "threads.send": { run: { id: "run-1" } },
      "threads.get": { runs: [{ id: "run-1", state, error: "Model unavailable" }], messages: [] },
    });
    const result = await invoke("apx_ask", { agent: "superagent", text: "Continue", thread: "existing" });
    assert.deepEqual(result.content, [{ type: "text", text: `${expected}\n\n(thread existing)` }]);
    assert.deepEqual(
      calls.map(([name]) => name),
      ["threads.send", "threads.get"],
    );
  }
});

test("outside-app MCP read limits messages, identifies authors and removes non-text parts", async (t) => {
  const { invoke } = await tools(t, {
    "threads.get": {
      messages: [
        { author: { kind: "user" }, parts: [{ type: "text", text: "Earlier" }] },
        { author: { kind: "agent", id: "superagent" }, parts: [{ type: "image" }, { type: "text", text: "Answer" }] },
        { author: { kind: "client" }, parts: [{ type: "text", text: "Follow-up" }] },
      ],
    },
  });
  assert.deepEqual((await invoke("apx_read", { thread: "existing", last: 2 })).content, [
    { type: "text", text: "superagent: Answer\n\nyou: Follow-up" },
  ]);
  assert.deepEqual((await invoke("apx_read", { thread: "existing" })).content, [
    { type: "text", text: "owner: Earlier\n\nsuperagent: Answer\n\nyou: Follow-up" },
  ]);
});

test("outside-app MCP reports authorization errors without throwing or sending another request", async (t) => {
  for (const [name, args, method] of [
    ["apx_agents", {}, "agents.list"],
    ["apx_ask", { agent: "superagent", text: "Hello", thread: "forbidden" }, "threads.send"],
    ["apx_read", { thread: "forbidden" }, "threads.get"],
  ] as const) {
    const { invoke, calls } = await tools(t, {
      [method]: new ApxError({ code: "unauthorized", message: "Not shared with this app" }),
    });
    const result = await invoke(name, args);
    assert.equal(result.isError, true);
    assert.deepEqual(result.content, [{ type: "text", text: "unauthorized: Not shared with this app" }]);
    assert.equal(calls.length, 1);
  }
});

test("outside-app MCP enforces input bounds before a core call", async (t) => {
  const { invoke, calls } = await tools(t, {});
  for (const [name, args] of [
    ["apx_ask", { agent: "superagent", text: "" }],
    ["apx_ask", { agent: "superagent", text: "x".repeat(20_001) }],
    ["apx_read", { thread: "chat", last: 0 }],
    ["apx_read", { thread: "chat", last: 51 }],
  ] as const)
    assert.equal((await invoke(name, args)).isError, true);
  assert.deepEqual(calls, []);
});
