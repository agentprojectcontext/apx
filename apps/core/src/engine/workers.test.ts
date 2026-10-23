import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { realpath } from "../paths.ts";
import { workspaceOf } from "./delegation.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const worker = { name: "Researcher", instructions: "Dig through sources; list each with its link." };
let subpathProjectRoot: string | undefined;

const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
  if (system.startsWith("You are Researcher")) {
    if (said.includes("read marker.txt"))
      return afterTool
        ? say(`Read: ${String(req.messages.at(-1)?.content).slice(0, 200)}`)
        : callTool("r1", "file_read", { path: "marker.txt" });
    if (said.includes("slowly")) await new Promise((r) => setTimeout(r, 300));
    return say("## Report\n- Found 2 sources.\n- One is stale.");
  }
  if (said.includes("<delegation_result")) return say("The researcher is back: 2 sources.");
  if (said.includes("delegate to a project subpath") && !afterTool && subpathProjectRoot)
    return callTool("w6", "delegate", {
      worker,
      project: path.join(subpathProjectRoot, "sub"),
      task: "read marker.txt",
    });
  if (said.includes("continue it at the root") && !afterTool && subpathProjectRoot)
    return callTool("w9", "delegate", {
      session: "researcher",
      project: subpathProjectRoot,
      write: "ask",
      task: "and the root too",
    });
  if (said.includes("delegate through a link") && !afterTool && subpathProjectRoot)
    return callTool("w7", "delegate", { worker, project: path.join(subpathProjectRoot, "link"), task: "x" });
  if (said.includes("delegate with more writes") && !afterTool && subpathProjectRoot)
    return callTool("w8", "delegate", {
      worker,
      project: path.join(subpathProjectRoot, "sub"),
      write: "auto",
      task: "read marker.txt",
    });
  if (said.includes("use a worker") && !afterTool)
    return callTool("w1", "delegate", { worker: { ...worker, tools: ["recall"] }, task: "look into A2A" });
  if (said.includes("worker slowly") && !afterTool)
    return callTool("w2", "delegate", { worker, task: "look slowly", wait_s: 0 });
  if (said.includes("continue it") && !afterTool)
    return callTool("w3", "delegate", { session: "researcher", task: "and one more" });
  if (said.includes("delegate to me") && !afterTool) return callTool("w4", "delegate", { agent: "roby", task: "x" });
  if (said.includes("ambiguous delegation") && !afterTool)
    return callTool("w5", "delegate", { agent: "roby", worker, task: "x" });
  return say(afterTool ? `Done: ${String(req.messages.at(-1)?.content).slice(0, 60)}` : "ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
const card = (parts: Part[] | undefined) =>
  parts?.find((p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread");

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("a worker runs as the caller under the instructions it wrote, with only the tools it named and no delegate", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "w" });
  await env.client.call("threads.send", { thread: t.id, text: "use a worker" });
  const { messages } = await env.settle(t.id);
  const c = card(messages.at(-1)?.parts);
  assert.ok(c);
  assert.equal(c.worker, "Researcher");
  assert.equal(c.agent_id, "roby");
  assert.equal(c.state, "completed");
  assert.match(c.summary ?? "", /## Report[\s\S]*One is stale/, "the whole report, not a clipped line");
  assert.equal(typeof c.ms, "number");

  const call = llm.calls.find((x) => String(x.messages[0]?.content).startsWith("You are Researcher"));
  assert.ok(call);
  const system = String(call.messages[0]?.content);
  assert.match(system, /a worker Roby started/);
  assert.match(system, /Dig through sources/);
  assert.doesNotMatch(system, /Your personality|## Your owner/);
  assert.deepEqual(
    (call.tools ?? []).map((x) => x.function.name),
    ["recall"],
  );
  // Roby read the report as another agent's data.
  assert.ok(
    llm.calls.some((x) =>
      x.messages.some((m) => m.role === "tool" && String(m.content).includes('<agent_reply from="Researcher"')),
    ),
  );
});

test("a worker's session goes on with the same instructions", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "w2" });
  await env.client.call("threads.send", { thread: t.id, text: "use a worker" });
  await env.settle(t.id);
  const from = llm.calls.length;
  await env.client.call("threads.send", { thread: t.id, text: "continue it" });
  const { messages } = await env.settle(t.id);
  assert.equal(card(messages.at(-1)?.parts)?.worker, "Researcher");
  assert.ok(
    llm.calls.slice(from).some((x) => /Dig through sources/.test(String(x.messages[0]?.content))),
    "the continued turn kept the worker's prompt",
  );
});

test("a late worker result shows its report above the caller's new answer", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "w3" });
  await env.client.call("threads.send", { thread: t.id, text: "worker slowly" });
  const until = Date.now() + 5000;
  let got = await env.client.call("threads.get", { thread: t.id });
  while (Date.now() < until && !texts(got.messages).some((x) => x.includes("researcher is back"))) {
    await new Promise((r) => setTimeout(r, 40));
    got = await env.client.call("threads.get", { thread: t.id });
  }
  const woken = got.messages.at(-1);
  assert.ok(texts(woken ? [woken] : []).some((x) => x.includes("researcher is back")));
  const report = card(woken?.parts);
  assert.ok(report, "the woken answer carries the report card");
  assert.equal(woken?.parts[0]?.type, "subthread", "the report comes first");
  assert.match(report.summary ?? "", /2 sources/);
  assert.equal(report.state, "completed");
});

/** A project with sub/marker.txt in it and a link to a folder outside it; the folders are removed after `body`. */
async function withProject(body: (root: string, project: string) => Promise<void>) {
  const root = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-delegate-subpath-")));
  const outside = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-delegate-outside-")));
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", "marker.txt"), "northwind marker\n");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Project\n");
  fs.symlinkSync(outside, path.join(root, "link"));
  try {
    const { project } = await env.client.call("projects.register", { path: root });
    subpathProjectRoot = root;
    await body(root, project.id);
  } finally {
    subpathProjectRoot = undefined;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

const lastToolResult = () =>
  String(
    llm.calls
      .flatMap((c) => c.messages)
      .filter((m) => m.role === "tool")
      .at(-1)?.content,
  );

test("a path inside the project is the folder a delegation works in: relative reads land there, its result returns", async () => {
  await withProject(async (root, project) => {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
    await env.client.call("threads.send", { thread: t.id, text: "delegate to a project subpath" });
    await env.settle(t.id);
    const sub = env.core.store.threads.sessions(t.id)[0];
    assert.equal(sub?.project_id, project);
    assert.equal(sub?.cwd, path.join(root, "sub"));
    // Nobody asked for more: it may change files as far as its caller may (Roby works in auto).
    assert.equal(sub?.write, "auto");
    assert.equal(sub?.parent_id, t.id);
    const child = env.core.store.runs.list(sub?.id ?? "")[0];
    assert.ok(child?.parent_run_id, "the session's run belongs to the caller's run");
    // The worker read marker.txt by its relative path, and the caller got that back in its turn.
    const result = lastToolResult();
    assert.match(result, /Read: [\s\S]*northwind marker/);
    assert.ok(result.includes(`It works in ${path.join(root, "sub")}, writes: auto.`), result);
  });
});

test("continuing a session in another folder of the project goes on in it, now working there", async () => {
  await withProject(async (root, project) => {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
    await env.client.call("threads.send", { thread: t.id, text: "delegate to a project subpath" });
    await env.settle(t.id);
    await env.client.call("threads.send", { thread: t.id, text: "continue it at the root" });
    await env.settle(t.id);
    const result = lastToolResult();
    assert.doesNotMatch(result, /refused/);
    assert.match(result, new RegExp(`It works in ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`));
    const sessions = env.core.store.threads.sessions(t.id);
    assert.deepEqual(
      sessions.map((s) => [s.session, s.cwd]),
      [["researcher", root]],
      "one session, moved to the root with its context",
    );
  });
});

test("a delegation's folder never leaves the project, through a link or otherwise", async () => {
  await withProject(async (_root, project) => {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
    await env.client.call("threads.send", { thread: t.id, text: "delegate through a link" });
    await env.settle(t.id);
    assert.match(lastToolResult(), /refused: .*link is outside the project's folder/);
    assert.equal(env.core.store.threads.sessions(t.id).length, 0);
  });
});

test("a delegation's write policy is never looser than its caller's", async () => {
  await withProject(async (root, project) => {
    const code = await env.client.call("threads.create", {
      kind: "code",
      agent_id: "roby",
      project_id: project,
      write: "read-only",
    });
    await env.client.call("threads.send", { thread: code.id, text: "delegate with more writes" });
    await env.settle(code.id);
    assert.equal(env.core.store.threads.sessions(code.id)[0]?.write, "read-only");
    assert.match(lastToolResult(), /writes: read-only \(auto would go further than you may\)/);

    // Outside a folder, an agent that asks before every change hands on no more than that; others as far as they may.
    const store = env.core.store;
    const roby = store.agents.get("roby");
    const chat = store.threads.get(
      (await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project })).id,
    );
    assert.ok(roby && chat);
    const asked = { folder: "sub", write: "auto" } as const;
    const vera = store.agents.get("vera");
    assert.ok(vera);
    assert.deepEqual(workspaceOf(store, { ...roby, autonomy: "manual" }, vera, chat, project, asked), {
      cwd: path.join(root, "sub"),
      write: "ask",
    });
    assert.equal(
      (workspaceOf(store, { ...roby, autonomy: "auto" }, vera, chat, project, asked) as { write: string }).write,
      "auto",
    );
    // A folder asked with no policy: as far as its caller may, never more.
    assert.equal((workspaceOf(store, roby, vera, chat, project, { folder: "sub" }) as { write: string }).write, "auto");
    const manual = { ...roby, autonomy: "manual" as const };
    assert.equal(
      (workspaceOf(store, manual, vera, chat, project, { folder: "sub" }) as { write: string }).write,
      "ask",
      "never more than its caller",
    );
    // A caller in total mode does not lift a callee, or a project it works in, kept stricter.
    const total = { ...roby, autonomy: "total" as const };
    const planner = { ...vera, autonomy: "plan" as const };
    assert.equal((workspaceOf(store, total, planner, chat, project, asked) as { write: string }).write, "read-only");
    await env.client.call("projects.update", { project, autonomy: "manual" });
    assert.equal(
      (workspaceOf(store, total, vera, chat, project, asked) as { write: string }).write,
      "ask",
      "the project's own mode caps it",
    );
    await env.client.call("projects.update", { project, autonomy: null });
    assert.equal(workspaceOf(store, roby, vera, chat, project, {}), undefined, "nothing asked: no folder of its own");
    assert.match(
      String(workspaceOf(store, roby, vera, chat, project, { folder: "../.." })),
      /outside the project's folder/,
    );
  });
});

test("an agent still cannot delegate to itself", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "w4" });
  await env.client.call("threads.send", { thread: t.id, text: "delegate to me" });
  const { messages } = await env.settle(t.id);
  assert.match(texts(messages).at(-1) ?? "", /cannot delegate to yourself/);
  assert.equal(env.core.store.threads.sessions(t.id).length, 0);
  const refusal = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(refusal, /complete this task directly/);
  assert.doesNotMatch(refusal, /start a worker/);
});

test("an ambiguous delegation is an invalid call, not a successful tool card", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "ambiguous delegation" });
  const { messages } = await env.settle(t.id);
  const tool = messages.at(-1)?.parts.find((p) => p.type === "tool");
  assert.equal(tool?.type === "tool" && tool.status, "error");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /give agent or worker, not both/);
  assert.equal(env.core.store.threads.sessions(t.id).length, 0);
});
