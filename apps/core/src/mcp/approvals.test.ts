import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { callTool, inputOrEnd, pendingInput, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { removeDir } from "../testkit/platform.ts";
import { createMcp } from "./manager.ts";

const SERVER = path.join(import.meta.dirname, "fake-server.test-support.mjs");
const llm = () =>
  scriptedLlm((req, { said, afterTool }) => {
    if (said.startsWith("grant") && !afterTool)
      return callTool("g", "grant_tool", { agent: said === "grant" ? "reader" : "roby", tools: ["mcp_notes_*"] });
    if (said.startsWith("grant")) return say("Granted");
    if (said === "bridge" && !afterTool)
      return callTool("b", "mcp_call", { tool: "mcp_notes_echo", args: { text: "b" } });
    // Its result is outside data: the same tool through the bridge now waits for the owner, as a direct call does.
    if (said === "bridge" && String(req.messages.at(-1)?.content).includes("echo: b\n"))
      return callTool("b2", "mcp_call", { tool: "mcp_notes_echo", args: { text: "b2" } });
    if (said === "bridge") return say(`Bridged: ${String(req.messages.at(-1)?.content)}`);
    if (!afterTool) return callTool("first", "mcp_notes_echo", { text: `first:${said}` });
    if (String(req.messages.at(-1)?.content).includes("echo: first:"))
      return callTool("second", "mcp_notes_echo", { text: `second:${said}` });
    return say("Done");
  });

async function setup() {
  const env = await startCore({ llm: llm() });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-grants-"));
  fs.mkdirSync(path.join(root, ".apc"));
  fs.writeFileSync(
    path.join(root, ".apc", "mcps.json"),
    JSON.stringify({
      mcpServers: { notes: { command: process.execPath, args: [SERVER] } },
    }),
  );
  const project = (await env.client.call("projects.register", { path: root })).project.id;
  await env.client.call("mcp.trust", { project, server: "notes", trusted: true });
  return {
    ...env,
    root,
    project,
    clean: async () => {
      await env.core.close();
      await env.cleanup();
      await removeDir(root);
    },
  };
}

const chat = (e: Awaited<ReturnType<typeof setup>>, agent = "roby") =>
  e.client.call("threads.create", { kind: "loose", agent_id: agent, project_id: e.project });

test("through mcp_call an MCP tool still waits for the owner, who is asked about that tool", async () => {
  const e = await setup();
  try {
    const t = await chat(e);
    await e.client.call("threads.send", { thread: t.id, text: "bridge" });
    const i = await pendingInput(e.client, t.id);
    assert.equal(i.tool, "mcp_notes_echo");
    await e.client.call("runs.respond", { input: i.id, decision: "approve" });
    const { messages } = await e.settle(t.id);
    assert.match(JSON.stringify(messages.at(-1)?.parts), /Bridged: .*echo: b/);
  } finally {
    await e.clean();
  }
});

test("one approval runs exactly once; no permanent grant is created", async () => {
  const e = await setup();
  try {
    const t = await chat(e);
    await e.client.call("threads.send", { thread: t.id, text: "read" });
    const i = await pendingInput(e.client, t.id);
    assert.deepEqual(i.approval_scopes, ["once", "session", "always"]);
    const r = await e.client.call("runs.respond", { input: i.id, decision: "approve" });
    assert.equal(r.approval_scope, "once");
    await e.settle(t.id);
    assert.deepEqual((await e.client.call("tools.approvals", {})).approvals, []);
    await e.client.call("threads.send", { thread: t.id, text: "read again" });
    assert.notEqual((await pendingInput(e.client, t.id)).id, i.id);
  } finally {
    await e.clean();
  }
});

test("session approval covers changed arguments and later turns, not another chat; revocation works", async () => {
  const e = await setup();
  try {
    const t = await chat(e);
    await e.client.call("threads.send", { thread: t.id, text: "read" });
    const i = await pendingInput(e.client, t.id);
    await e.client.call("runs.respond", { input: i.id, decision: "approve", scope: "session" });
    await e.settle(t.id);
    await e.client.call("threads.send", { thread: t.id, text: "different arguments" });
    await e.settle(t.id);
    const grants = (await e.client.call("tools.approvals", { thread: t.id })).approvals;
    assert.equal(grants.length, 1);
    assert.equal(grants[0]?.scope, "session");
    const other = await chat(e);
    await e.client.call("threads.send", { thread: other.id, text: "read" });
    await pendingInput(e.client, other.id);
    await e.client.call("tools.revoke", { key: grants[0]?.key ?? "", thread: t.id });
    await e.client.call("threads.send", { thread: t.id, text: "read after revoke" });
    await pendingInput(e.client, t.id);
  } finally {
    await e.clean();
  }
});

test("always from a chat is that agent's, in every chat and after a restart; other agents still ask", async () => {
  const e = await setup();
  let next: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    const t = await chat(e);
    await e.client.call("threads.send", { thread: t.id, text: "read" });
    const i = await pendingInput(e.client, t.id);
    await e.client.call("runs.respond", { input: i.id, decision: "approve", scope: "always" });
    await e.settle(t.id);
    const again = await chat(e);
    await e.client.call("threads.send", { thread: again.id, text: "read" });
    await e.settle(again.id);
    const a = await e.client.call("agents.create", { slug: "reader", name: "Reader" });
    const other = await chat(e, a.id);
    await e.client.call("threads.send", { thread: other.id, text: "read" });
    const asked = await pendingInput(e.client, other.id);
    await e.client.call("runs.respond", { input: asked.id, decision: "deny" });
    await e.settle(other.id);
    await e.core.close();
    next = await startCore({ llm: llm(), home: e.home });
    await next.client.call("threads.send", { thread: again.id, text: "read after restart" });
    await next.settle(again.id);
    const [grant] = (await next.client.call("tools.approvals", {})).approvals;
    assert.equal(grant?.scope, "always");
    assert.equal(grant?.agent_id, "roby");
  } finally {
    if (next) await next.core.close();
    else await e.core.close();
    await e.cleanup();
    await removeDir(e.root);
  }
});

test("Resources allows any tool for every agent; global trust can be revoked and restored", async () => {
  const e = await setup();
  try {
    await e.client.call("mcp.set", { name: "mine", server: { command: process.execPath, args: [SERVER] } });
    const tools = (await e.client.call("mcp.tools", { scope: "global", server: "mine" })).tools;
    assert.equal(tools.find((t) => t.name === "echo")?.permanent, true);
    assert.equal(tools.find((t) => t.name === "token")?.permanent, false);
    await e.client.call("mcp.approveTool", { scope: "global", server: "mine", tool: "token" });
    await e.client.call("mcp.approveTool", { scope: "global", server: "mine", tool: "echo" });
    const rows = (await e.client.call("tools.approvals", {})).approvals;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.agent_id === undefined));
    await e.client.call("mcp.trust", { server: "mine", trusted: false });
    assert.equal(
      (await e.client.call("mcp.list", {})).servers.find((s) => s.name === "mine")?.status,
      "needs-approval",
    );
    assert.equal((await e.client.call("tools.approvals", {})).approvals.length, 0);
    await assert.rejects(e.client.call("mcp.tools", { scope: "global", server: "mine" }), /approve/);
    await e.client.call("mcp.trust", { server: "mine", trusted: true });
    assert.equal((await e.client.call("mcp.tools", { scope: "global", server: "mine" })).tools.length, 2);
  } finally {
    await e.clean();
  }
});

test("a denied approval or a question cannot acquire broader scope; agents cannot grant permissions", async () => {
  const e = await setup();
  try {
    const t = await chat(e);
    await e.client.call("threads.send", { thread: t.id, text: "read" });
    const i = await pendingInput(e.client, t.id);
    await assert.rejects(
      e.client.call("runs.respond", { input: i.id, decision: "deny", scope: "always" }),
      /requires approving/,
    );
    const agentClient = new ApxClient({ url: e.core.url, actor: "agent" });
    await assert.rejects(
      agentClient.call("mcp.approveTool", { scope: "project", server: "notes", project: e.project, tool: "echo" }),
      /owner|human|not allowed|unauthorized/,
    );
    await e.client.call("runs.respond", { input: i.id, decision: "deny" });
    await e.settle(t.id);
    assert.deepEqual((await e.client.call("tools.approvals", {})).approvals, []);
  } finally {
    await e.clean();
  }
});

test("a permanent approval releases the agent's other chats already waiting on the same tool", async () => {
  const e = await setup();
  try {
    const first = await chat(e);
    const second = await chat(e);
    await e.client.call("threads.send", { thread: first.id, text: "first reader" });
    const i = await pendingInput(e.client, first.id);
    await e.client.call("threads.send", { thread: second.id, text: "second reader" });
    const other = await pendingInput(e.client, second.id);
    await e.client.call("runs.respond", { input: i.id, decision: "approve", scope: "always" });
    await e.settle(first.id);
    await e.settle(second.id);
    assert.equal(e.core.store.inputs.get(other.id)?.state, "approved");
    assert.deepEqual((await e.client.call("runs.pending", {})).inputs, []);
  } finally {
    await e.clean();
  }
});

test("a chat grant outlives a restart (DECISIONS.md#d-109); delayed one-shot grants persist and bind the tool contract", async () => {
  const e = await setup();
  let next: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    const t = await chat(e);
    await e.client.call("threads.send", { thread: t.id, text: "read" });
    const i = await pendingInput(e.client, t.id);
    await e.client.call("runs.respond", { input: i.id, decision: "approve", scope: "session" });
    await e.settle(t.id);
    e.core.store.approvals.grantOnce(t.id, "roby", "mcp_notes_echo", { text: "same" }, "original-contract");
    await e.core.close();
    next = await startCore({ llm: llm(), home: e.home });
    assert.equal((await next.client.call("tools.approvals", {})).approvals.length, 1);
    assert.equal(
      next.core.store.approvals.takeOnce(t.id, "roby", "mcp_notes_echo", { text: "same" }, "changed-contract"),
      false,
    );
    assert.equal(
      next.core.store.approvals.takeOnce(t.id, "roby", "mcp_notes_echo", { text: "same" }, "original-contract"),
      true,
    );
    assert.equal(
      next.core.store.approvals.takeOnce(t.id, "roby", "mcp_notes_echo", { text: "same" }, "original-contract"),
      false,
    );
    await next.client.call("threads.send", { thread: t.id, text: "read after restart" });
    await next.settle(t.id);
    assert.equal((await next.client.call("runs.pending", { thread: t.id })).inputs.length, 0, "the chat's grant held");
  } finally {
    if (next) await next.core.close();
    else await e.core.close();
    await e.cleanup();
    await removeDir(e.root);
  }
});

test("changing a server revokes its grants and demands approval again", async () => {
  const e = await setup();
  try {
    await e.client.call("mcp.approveTool", { scope: "project", project: e.project, server: "notes", tool: "echo" });
    assert.equal((await e.client.call("tools.approvals", {})).approvals.length, 1);
    await e.client.call("mcp.set", {
      project: e.project,
      name: "notes",
      server: { command: process.execPath, args: [SERVER], env: { MODE: "changed" } },
    });
    assert.equal((await e.client.call("tools.approvals", {})).approvals.length, 0);
    const t = await chat(e);
    await e.client.call("threads.send", { thread: t.id, text: "read" });
    await pendingInput(e.client, t.id);
  } finally {
    await e.clean();
  }
});

test("a tool that becomes destructive on reconnection cannot use its old reading approval", async () => {
  const e = await setup();
  const mcp = createMcp({
    store: e.core.store,
    secrets: e.core.secrets,
    log: createLog("test", true),
    workDir: path.join(e.root, "mcp"),
  });
  try {
    const mode = path.join(e.root, "mode.txt");
    fs.writeFileSync(mode, "read");
    await e.client.call("mcp.set", {
      name: "mutable",
      server: { command: process.execPath, args: [SERVER], env: { TOOL_MODE_FILE: mode } },
    });
    const thread = await chat(e);
    const tools = await mcp.toolsFor(thread);
    const old = tools.find((t) => t.name === "mcp_mutable_echo");
    assert.ok(old?.approval);
    e.core.store.approvals.grant(old.approval, "always", "");
    await mcp.close();
    fs.writeFileSync(mode, "write");
    const agent = e.core.store.agents.get("roby");
    assert.ok(agent);
    const run = e.core.store.runs.create({
      thread_id: thread.id,
      agent_id: agent.id,
      trigger: "user",
      input: { text: "test", origin: { kind: "user" } },
      deadline_at: new Date(Date.now() + 5000).toISOString(),
    });
    const unused = async (): Promise<never> => {
      throw new Error("unused");
    };
    await assert.rejects(
      old.run(
        { text: "must not run" },
        {
          agent,
          thread: { ...thread, reach: "card" },
          run,
          signal: new AbortController().signal,
          untrusted: () => true,
          upsertPart: () => {},
          call: unused,
          delegate: unused,
          askOwner: unused,
          requestGrant: unused,
          proposeAction: unused,
          withdrawQuestion: () => {
            throw new Error("unused");
          },
          runCommand: unused,
        },
      ),
      /tool contract changed/,
    );
  } finally {
    await mcp.close();
    await e.clean();
  }
});

test("archiving a chat ends its session approval and expired confirmations stay expired", async () => {
  const e = await setup();
  try {
    const t = await chat(e);
    await e.client.call("threads.send", { thread: t.id, text: "read" });
    const i = await pendingInput(e.client, t.id);
    await e.client.call("runs.respond", { input: i.id, decision: "approve", scope: "session" });
    await e.settle(t.id);
    await e.client.call("threads.update", { thread: t.id, archived: true });
    assert.equal((await e.client.call("tools.approvals", {})).approvals.length, 0);
    const rec = e.core.store.inputs.get(i.id);
    assert.ok(rec?.approval);
    const expired = e.core.store.inputs.create({
      run_id: rec.run_id,
      thread_id: t.id,
      agent_id: rec.agent_id,
      call_id: "expired",
      kind: "confirm",
      tool: rec.tool,
      approval: rec.approval,
      prompt: "expired",
      waitMs: -1,
    });
    e.core.store.approvals.grant(rec.approval, "always", "");
    assert.notEqual(e.core.store.inputs.get(expired.id)?.state, "approved");
    await assert.rejects(
      e.client.call("runs.respond", { input: expired.id, decision: "approve", scope: "always" }),
      /expired/,
    );
  } finally {
    await e.clean();
  }
});

test("an agent hands its MCP tools to another one for good, never to itself", async () => {
  const e = await setup();
  try {
    const reader = await e.client.call("agents.create", { slug: "reader", name: "Reader" });
    const roby = await chat(e);
    await e.client.call("threads.send", { thread: roby.id, text: "grant" });
    await e.settle(roby.id);
    const grants = (await e.client.call("tools.approvals", {})).approvals;
    assert.deepEqual(
      grants.map((g) => [g.tool, g.agent_id]),
      [
        ["echo", reader.id],
        ["token", reader.id],
      ],
    );
    const theirs = await chat(e, reader.id);
    await e.client.call("threads.send", { thread: theirs.id, text: "read" });
    await e.settle(theirs.id);
    assert.deepEqual((await e.client.call("runs.pending", {})).inputs, []);
    await e.client.call("threads.send", { thread: roby.id, text: "grant myself" });
    await e.settle(roby.id);
    assert.equal((await e.client.call("tools.approvals", {})).approvals.length, 2);
  } finally {
    await e.clean();
  }
});

test("an agent that asks the owner for a tool cannot hand it to another one", async () => {
  const e = await setup();
  try {
    await e.client.call("agents.create", { slug: "reader", name: "Reader" });
    await e.client.call("agents.update", { agent: "roby", autonomy: "manual" });
    const roby = await chat(e);
    await e.client.call("threads.send", { thread: roby.id, text: "grant" });
    // On autonomy ask the owner confirms the grant itself.
    const input: { id: string } | undefined = await inputOrEnd(e.client, roby.id);
    await e.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" });
    await e.settle(roby.id);
    // Only the read-only tool it runs freely passes on; the one it must ask for stays with the owner.
    const grants = (await e.client.call("tools.approvals", {})).approvals;
    assert.deepEqual(
      grants.map((g) => g.tool),
      ["echo"],
    );
  } finally {
    await e.clean();
  }
});
