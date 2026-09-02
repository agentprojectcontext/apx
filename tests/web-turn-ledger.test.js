// What a web chat turn leaves behind, so it can be found and read again.
//
// Two regressions, both reported from the panel: a chat started inside a
// project could not be found from that project afterwards, and reopening one
// showed the answer with every tool call erased. Both come from the same write
// path — logWebTurn recorded a user line and a reply line, nothing else:
//
//   - no project on the row, and the ledger is one file per channel+day for the
//     whole daemon, so the sidebar had nothing to scope by;
//   - no tool rows, so the reader had nothing to rebuild the steps from
//     (readGlobalThread has always understood them — the Telegram path writes
//     them and its threads render fine).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The ledger lives under ~/.apx/messages — point HOME somewhere disposable
// BEFORE the modules resolve their paths at import time.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-web-turn-home-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const express = (await import("express")).default;
const { register, logWebTurn } = await import("#host/daemon/api/super-agent.js");
const { register: registerConversations } = await import("#host/daemon/api/conversations.js");
const { eventsClients } = await import("#host/daemon/events-ws.js");
const { readGlobalThread, listGlobalThreads, appendGlobalMessage, getRecentChannelTurnsFromFs } =
  await import("#core/stores/messages.js");
const { apiRouter, makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const TODAY = new Date().toISOString().slice(0, 10);

/** The chat route, mounted over a single project, answering on the mock engine. */
async function serveChat(root) {
  const app = express();
  app.use(express.json());
  const p = { id: 8, name: "postbeam", path: root, storagePath: path.join(TMP_HOME, ".apx", "projects", "8"), config: null };
  const projects = { list: () => [p], get: () => p, rebuild: () => {} };
  const router = apiRouter(express, app);
  const ctx = {
    projects,
    registries: null,
    plugins: { get: () => null },
    project: () => p,
    config: {
      super_agent: { enabled: true, name: "apx", model: "mock:test", permission_mode: "total" },
      engines: {},
    },
  };
  register(router, ctx);
  registerConversations(router, ctx);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test("a web turn is stamped with its project and keeps its tool calls", async () => {
  const root = makeTempProject({ name: "postbeam" });
  const { server, url } = await serveChat(root);
  try {
    const res = await fetch(`${url}/api/projects/8/super-agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The mock engine calls the named tool, then answers on the next pass.
      body: JSON.stringify({ prompt: "listá los proyectos [mock:tool:list_projects]", channel: "web", confirm: false }),
    });
    assert.equal(res.status, 200);
    await res.json();

    // Scoped: the project that hosted the chat finds it.
    const mine = listGlobalThreads({ project: "8" });
    assert.ok(mine.some((t) => t.channel === "web" && t.id === TODAY), "the chat must be listed under its own project");
    // And a different project does not.
    assert.equal(
      listGlobalThreads({ project: "99" }).some((t) => t.channel === "web" && t.id === TODAY),
      false,
      "another project must not inherit it",
    );

    const thread = readGlobalThread({ channel: "web", date: TODAY, project: "8" });
    assert.ok(thread, "the thread must be readable back");

    const user = thread.messages.find((m) => m.role === "user");
    assert.ok(user, "the prompt is part of the record");

    const tool = thread.messages.find((m) => m.role === "tool");
    assert.ok(tool, "reopening the chat must still show what the agent did");
    assert.equal(tool.tool, "list_projects");

    const assistant = thread.messages.find((m) => m.role === "assistant");
    assert.ok(assistant, "the answer is part of the record");
    assert.ok(assistant.tool_summary, "the compact summary rides on the answer row");
    assert.ok(assistant.tool_summary.total >= 1);
  } finally {
    await new Promise((r) => server.close(r));
    cleanupTempProject(root);
  }
});

test("a streamed Roby turn survives its pane: shared frames plus thread snapshot", async () => {
  const root = makeTempProject({ name: "northwind" });
  const { server, url } = await serveChat(root);
  const frames = [];
  const ws = {
    readyState: 1,
    send: (raw) => frames.push(JSON.parse(String(raw))),
  };
  eventsClients.add(ws);
  try {
    const res = await fetch(`${url}/api/projects/8/super-agent/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "seguí trabajando [mock:tool:list_projects] [mock:slow:250]", channel: "web", confirm: false }),
    });

    // Headers arrive before the mock finishes. A pane opened now must catch up
    // from the daemon instead of waiting for a start frame it already missed.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const during = await fetch(`${url}/api/projects/8/super-agent/threads/web/${TODAY}`);
    assert.equal(during.status, 200);
    const detail = await during.json();
    assert.equal(detail.active_turn?.channel, "web");
    assert.equal(detail.active_turn?.thread_id, TODAY);
    assert.ok(
      detail.active_turn?.parts?.some((part) => part.kind === "tool" && part.tool === "list_projects"),
      "a reloaded pane sees tools already used by the live turn",
    );

    await res.text();
    const turnFrames = frames.filter((frame) => frame.type === "turn");
    assert.ok(turnFrames.some((frame) => frame.phase === "start"), "every rail sees work start");
    assert.ok(turnFrames.some((frame) => frame.phase === "final"), "a hidden rail sees work finish");
    assert.ok(turnFrames.every((frame) => frame.thread_id === TODAY));
  } finally {
    eventsClients.delete(ws);
    await new Promise((resolve) => server.close(resolve));
    cleanupTempProject(root);
  }
});

test("streamed prose survives alongside tools, but only the final reply feeds history", () => {
  const before = readGlobalThread({ channel: "web", date: TODAY, project: "8" })?.messages.length || 0;
  const trace = { id: "tool-1", tool: "list_projects", args: { scope: "current" }, result: { ok: true } };
  logWebTurn("web", {
    replyText: "Resultado final.",
    name: "APX",
    model: "mock:test",
    usage: { input_tokens: 5, output_tokens: 3 },
    trace: [trace],
    project: { id: "8", name: "postbeam" },
    timeline: [
      { kind: "text", text: "Primero verifico recursos." },
      { kind: "tool", trace },
      { kind: "text", text: "Resultado final." },
    ],
  });
  const thread = readGlobalThread({ channel: "web", date: TODAY, project: "8" });
  const written = thread.messages.slice(before);
  assert.deepEqual(written.map((m) => m.role), ["assistant", "tool", "assistant"]);
  assert.equal(written[0].content, "Primero verifico recursos.");
  assert.equal(written[1].tool, "list_projects");
  assert.equal(written[2].content, "Resultado final.");
  // The global web ledger is project-scoped rather than chat-id scoped. Check
  // the source rows: the reader uses `streamed` to keep progress out of the
  // next prompt while still returning it to a reopened browser pane.
  const rows = fs.readFileSync(path.join(process.env.APX_HOME, "messages", "web", `${TODAY}.jsonl`), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  const created = rows.slice(-3);
  assert.equal(created[0].meta.streamed, true);
  assert.equal(created[2].meta.streamed, undefined);
  assert.equal(created[2].meta.model, "mock:test");
});

// Third regression, same shape as the tool calls: the skill badges under a turn
// came off a live stream event, so refreshing the page erased which skills had
// paid for that turn's prompt. The decision now rides the answer row.
test("the skill inspector's decision survives a reopen", () => {
  const decision = {
    embedder: "ollama:nomic-embed-text",
    loaded: ["apx-voice"],
    hinted: ["apx-telegram", "apx-skill-builder"],
    scored: [{ slug: "apx-voice", sim: 0.64 }, { slug: "apx-telegram", sim: 0.44 }],
  };
  appendGlobalMessage({
    channel: "web",
    direction: "out",
    type: "agent",
    actor_id: "super_agent",
    actor_kind: "superagent",
    agent_slug: "super_agent",
    body: "para la voz necesitás…",
    meta: { project_id: "8", project_name: "postbeam", skill_inspector: decision },
  });

  const thread = readGlobalThread({ channel: "web", date: TODAY, project: "8" });
  const answer = thread.messages.filter((m) => m.role === "assistant").at(-1);
  assert.deepEqual(
    answer.skill_inspector,
    decision,
    "the badges must be rebuildable from the record alone",
  );
});

// Same for the thinking: it travels on its own event and never inside the
// answer text, so nothing was left of it once the stream closed.
test("the model's thinking survives a reopen, and stays out of what feeds the model", () => {
  const thinking = ["Primero reviso las sesiones.", "Con eso ya puedo contestar."];
  appendGlobalMessage({
    channel: "web",
    direction: "out",
    type: "agent",
    actor_id: "super_agent",
    actor_kind: "superagent",
    agent_slug: "super_agent",
    body: "Listo — ya traje la skill.",
    meta: { project_id: "8", project_name: "postbeam", reasoning: thinking },
  });

  const thread = readGlobalThread({ channel: "web", date: TODAY, project: "8" });
  const answer = thread.messages.filter((m) => m.role === "assistant").at(-1);
  assert.deepEqual(answer.reasoning, thinking, "the thread viewer gets the thinking back");
  assert.equal(
    answer.content.includes(thinking[0]),
    false,
    "and it never leaks into the answer text",
  );

  // What the agent reads back as history is built from rows, not from meta —
  // the thinking must not come back to it as context.
  const turns = getRecentChannelTurnsFromFs({ channel: "web", limit: 20 });
  assert.equal(
    turns.some((t) => String(t.content || "").includes(thinking[0])),
    false,
    "the model must not be fed its own notes",
  );
});
