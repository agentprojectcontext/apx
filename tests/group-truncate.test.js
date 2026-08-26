// truncateGroupThread — group rewind for "regenerate" / "edit & resend".
// keepVisible counts OWNER + AGENT turns only; tool rows ride with their agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-group-trunc-home-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const {
  appendMessageToFs,
  createGroupThread,
  appendGroupOwnerMessage,
  appendGroupAgentMessage,
  truncateGroupThread,
  readProjectGroupThread,
} = await import("#core/stores/messages.js");

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-group-trunc-"));
  const logMessage = (row) => appendMessageToFs({ projectRoot: root, ...row });
  return { root, logMessage };
}

function seedWithTools(logMessage) {
  const gid = createGroupThread(logMessage, { participants: ["candela", "nati"], title: "test" });
  appendGroupOwnerMessage(logMessage, gid, "hola grupo");
  appendGroupAgentMessage(logMessage, gid, {
    slug: "candela",
    body: "soy candela",
    trace: [
      { tool: "search", args: { q: "x" }, result: "ok" },
      { tool: "read", args: { path: "a" }, result: "ok" },
    ],
  });
  appendGroupAgentMessage(logMessage, gid, { slug: "nati", body: "soy nati" });
  return gid;
}

test("regen after an agent-with-tools keeps that agent (tools do not inflate the cut)", () => {
  const s = makeStore();
  try {
    const gid = seedWithTools(s.logMessage);
    // Pane bubbles: owner, candela, nati → regenerating nati keeps 2 turns.
    // Before the fix, keepVisible=2 cut after owner+first-tool and wiped candela.
    const out = truncateGroupThread(s.root, gid, 2);
    assert.ok(out.removed >= 1, "nati should be dropped");
    const thread = readProjectGroupThread(s.root, gid);
    const textTurns = thread.messages
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .map((m) => `${m.role}:${m.agent || "owner"}:${m.content}`);
    assert.deepEqual(textTurns, [
      "user:owner:hola grupo",
      "assistant:candela:soy candela",
    ]);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("regen of the first agent after the owner keeps the owner line", () => {
  const s = makeStore();
  try {
    const gid = seedWithTools(s.logMessage);
    // Keep only the owner turn — drop candela (with her tools) and nati.
    truncateGroupThread(s.root, gid, 1);
    const thread = readProjectGroupThread(s.root, gid);
    const visible = thread.messages.filter((m) => m.role === "user" || (m.role === "assistant" && m.content));
    assert.equal(visible.length, 1);
    assert.equal(visible[0].role, "user");
    assert.equal(visible[0].content, "hola grupo");
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("keepVisible 0 drops every owner/agent/tool row but leaves control rows", () => {
  const s = makeStore();
  try {
    const gid = seedWithTools(s.logMessage);
    truncateGroupThread(s.root, gid, 0);
    const thread = readProjectGroupThread(s.root, gid);
    assert.ok(thread, "group still exists via control row");
    assert.equal(thread.messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool").length, 0);
    assert.deepEqual(thread.participants, ["candela", "nati"]);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test("consecutive same-agent rows collapse like the pane — regen must not drop the owner", () => {
  const s = makeStore();
  try {
    const gid = createGroupThread(s.logMessage, { participants: ["candela", "nati"], title: "test" });
    appendGroupOwnerMessage(s.logMessage, gid, "listo comamos");
    // Two Candela replies with nobody in between — the pane shows ONE bubble.
    appendGroupAgentMessage(s.logMessage, gid, { slug: "candela", body: "primera" });
    appendGroupAgentMessage(s.logMessage, gid, { slug: "candela", body: "segunda (misma burbuja)" });
    appendGroupOwnerMessage(s.logMessage, gid, "y ahora?");
    appendGroupAgentMessage(s.logMessage, gid, { slug: "candela", body: "tercera" });
    // Pane bubbles: owner, candela(merged), owner, candela → regenerating the
    // last keeps 3. Counting ledger agent rows as 4 used to drop "y ahora?".
    truncateGroupThread(s.root, gid, 3);
    const thread = readProjectGroupThread(s.root, gid);
    const textTurns = thread.messages
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .map((m) => `${m.role}:${m.content}`);
    assert.deepEqual(textTurns, [
      "user:listo comamos",
      "assistant:primera",
      "assistant:segunda (misma burbuja)",
      "user:y ahora?",
    ]);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});
