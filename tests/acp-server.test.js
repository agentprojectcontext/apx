// ACP surface tests — fully offline. An in-process daemon API (mock engine)
// listens on a random port, and the ACP server runs against PassThrough
// streams standing in for stdio. The fake client below speaks newline-
// delimited JSON-RPC exactly like Zed & co.
//
// HOME points at a temp dir BEFORE any module import so nothing touches the
// real ~/.apx (message store, logs, confirmation store are all under APX_HOME).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-acp-home-"));
process.env.HOME = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
const { AcpAgentServer, ACP_PROTOCOL_VERSION } = await import("#interfaces/acp/index.js");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function startDaemon({ permissionMode = "total" } = {}) {
  const root = makeTempProject({ name: "ACP Project" });
  const projects = new ProjectManager({});
  projects.register(root);
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: {
      super_agent: { enabled: true, model: "mock", permission_mode: permissionMode },
    },
    token: "",
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return {
    root,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      cleanupTempProject(root);
    },
  };
}

// Minimal ACP *client*: drives the agent over PassThrough pipes, collects
// session/update notifications, and answers agent→client requests
// (session/request_permission) via registered handlers.
function makeAcpClient(baseUrl) {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const agent = new AcpAgentServer({
    input: toAgent,
    output: fromAgent,
    daemon: { baseUrl, token: "" },
  }).start();

  const pending = new Map();
  const notifications = [];
  const requestHandlers = new Map();
  let nextId = 0;
  let buffer = "";

  fromAgent.setEncoding("utf8");
  fromAgent.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (typeof msg.method === "string" && msg.id != null) {
        // Agent → client request.
        const handler = requestHandlers.get(msg.method);
        Promise.resolve(handler ? handler(msg.params) : null).then((result) => {
          toAgent.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
        });
      } else if (typeof msg.method === "string") {
        notifications.push(msg);
      } else if (pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        else resolve(msg.result);
      }
    }
  });

  return {
    agent,
    notifications,
    updates: () => notifications.filter((n) => n.method === "session/update").map((n) => n.params),
    onRequest: (method, fn) => requestHandlers.set(method, fn),
    request(method, params) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        toAgent.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    notify(method, params) {
      toAgent.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    },
    close: () => toAgent.end(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("ACP handshake: initialize → session/new → session/prompt with updates", async () => {
  const daemon = await startDaemon();
  const client = makeAcpClient(daemon.baseUrl);
  try {
    const init = await client.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    assert.equal(init.protocolVersion, ACP_PROTOCOL_VERSION);
    assert.equal(init.agentCapabilities.loadSession, false);
    assert.deepEqual(init.agentCapabilities.promptCapabilities, {
      image: false,
      audio: false,
      embeddedContext: false,
    });
    assert.deepEqual(init.agentCapabilities.mcpCapabilities, { http: false, sse: false });
    assert.equal(init.agentInfo.name, "apx");
    assert.deepEqual(init.authMethods, []);

    const created = await client.request("session/new", {
      cwd: daemon.root,
      mcpServers: [],
    });
    assert.match(created.sessionId, /^sess_[a-f0-9]{32}$/);

    const result = await client.request("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "[mock:tool:list_projects]" }],
    });
    assert.equal(result.stopReason, "end_turn");

    const updates = client.updates();
    assert.ok(updates.length >= 3, `expected >=3 session/update, got ${updates.length}`);
    for (const u of updates) assert.equal(u.sessionId, created.sessionId);

    const toolCall = updates.find((u) => u.update.sessionUpdate === "tool_call");
    assert.ok(toolCall, "expected a tool_call update");
    assert.equal(toolCall.update.title, "list_projects");
    assert.equal(toolCall.update.status, "in_progress");
    assert.equal(toolCall.update.kind, "read");

    const toolDone = updates.find((u) => u.update.sessionUpdate === "tool_call_update");
    assert.ok(toolDone, "expected a tool_call_update update");
    assert.equal(toolDone.update.toolCallId, toolCall.update.toolCallId);
    assert.equal(toolDone.update.status, "completed");
    assert.equal(toolDone.update.content[0].type, "content");

    const chunk = updates.find((u) => u.update.sessionUpdate === "agent_message_chunk");
    assert.ok(chunk, "expected an agent_message_chunk update");
    assert.match(chunk.update.content.text, /\[mock:mock\] received/);
  } finally {
    client.close();
    await daemon.close();
  }
});

test("ACP version negotiation and method errors", async () => {
  const daemon = await startDaemon();
  const client = makeAcpClient(daemon.baseUrl);
  try {
    // Unsupported (future) version → agent answers with the latest it supports.
    const init = await client.request("initialize", { protocolVersion: 99 });
    assert.equal(init.protocolVersion, ACP_PROTOCOL_VERSION);

    // Undeclared optional method → JSON-RPC method-not-found.
    await assert.rejects(
      client.request("session/load", { sessionId: "sess_x", cwd: daemon.root }),
      (e) => e.code === -32601
    );

    // Unknown session → invalid params.
    await assert.rejects(
      client.request("session/prompt", {
        sessionId: "sess_nope",
        prompt: [{ type: "text", text: "hi" }],
      }),
      (e) => e.code === -32602
    );
  } finally {
    client.close();
    await daemon.close();
  }
});

test("ACP permission round-trip: confirmation_required → session/request_permission → confirm", async () => {
  // "permiso" with no allowlist blocks every tool behind a confirmation.
  const daemon = await startDaemon({ permissionMode: "permiso" });
  const client = makeAcpClient(daemon.baseUrl);
  try {
    const permissionRequests = [];
    client.onRequest("session/request_permission", (params) => {
      permissionRequests.push(params);
      return { outcome: { outcome: "selected", optionId: "allow" } };
    });

    await client.request("initialize", { protocolVersion: 1 });
    const { sessionId } = await client.request("session/new", { cwd: daemon.root, mcpServers: [] });

    // run_shell is one of the tools that consults the permission guard;
    // "permiso" with no allowlist parks it on a confirmation.
    const result = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "[mock:tool:run_shell]" }],
    });
    assert.equal(result.stopReason, "end_turn");

    assert.equal(permissionRequests.length, 1);
    const req = permissionRequests[0];
    assert.equal(req.sessionId, sessionId);
    assert.ok(req.toolCall.toolCallId, "permission request carries a toolCallId");
    assert.deepEqual(
      req.options.map((o) => o.kind),
      ["allow_once", "reject_once"]
    );

    // Approved → the guard let the tool proceed and a result update followed.
    const toolDone = client
      .updates()
      .find((u) => u.update.sessionUpdate === "tool_call_update");
    assert.ok(toolDone, "tool reported a result after permission was granted");
  } finally {
    client.close();
    await daemon.close();
  }
});

test("ACP cancellation: session/cancel resolves the prompt with stopReason cancelled", async () => {
  const daemon = await startDaemon({ permissionMode: "permiso" });
  const client = makeAcpClient(daemon.baseUrl);
  try {
    await client.request("initialize", { protocolVersion: 1 });
    const { sessionId } = await client.request("session/new", { cwd: daemon.root, mcpServers: [] });

    // Cancel while the turn is parked on a permission request — the spec's
    // required client behavior: send session/cancel, then answer the pending
    // permission request with the "cancelled" outcome.
    client.onRequest("session/request_permission", () => {
      client.notify("session/cancel", { sessionId });
      return { outcome: { outcome: "cancelled" } };
    });

    const result = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "[mock:tool:run_shell]" }],
    });
    assert.equal(result.stopReason, "cancelled");
  } finally {
    client.close();
    await daemon.close();
  }
});

test("ACP multi-turn sessions accumulate previousMessages history", async () => {
  const daemon = await startDaemon();
  const client = makeAcpClient(daemon.baseUrl);
  try {
    await client.request("initialize", { protocolVersion: 1 });
    const { sessionId } = await client.request("session/new", { cwd: daemon.root, mcpServers: [] });

    const first = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "first turn" }],
    });
    assert.equal(first.stopReason, "end_turn");
    const second = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "second turn" }],
    });
    assert.equal(second.stopReason, "end_turn");

    // The next turn's previousMessages come from in-process history:
    // user + assistant per completed turn.
    const history = client.agent.sessions.get(sessionId).history;
    assert.equal(history.length, 4);
    assert.deepEqual(
      history.map((m) => m.role),
      ["user", "assistant", "user", "assistant"]
    );
    assert.equal(history[0].content, "first turn");
    assert.match(history[3].content, /second turn/);
  } finally {
    client.close();
    await daemon.close();
  }
});
