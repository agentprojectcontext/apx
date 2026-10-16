import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

function makeProject(root: string) {
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({ name: "Northwind", description: "A sample company", apx_id: "abc123def456", kind: "company" }),
  );
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Northwind\nUse metric units.\n");
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "arch.md"),
    "---\nname: Arch\nrole: Software Architect\nmodel: fake:fake-pro\nparent: ceo\nicon: saturno\n---\n\nKeep it simple.\n",
  );
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "ceo.md"),
    "---\nname: Ceo\nrole: Chief Executive\n---\n\nDecide.\n",
  );
}

test("a registered project's agents come from its files; edits and removals follow; the owner's choices stay", async () => {
  const llm = scriptedLlm((_r, { system }) =>
    say(system.includes("Use metric units.") ? "saw AGENTS.md" : "no context"),
  );
  const env = await startCore({ llm });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-apc-"));
  try {
    makeProject(root);
    const reg = await env.client.call("projects.register", { path: root });
    assert.equal(reg.project.id, "p_abc123def456");
    assert.equal(reg.project.name, "Northwind");
    assert.equal(reg.agents, 2);
    let { agents } = await env.client.call("agents.list", {});
    const arch = agents.find((a) => a.id === "abc123def456-arch");
    assert.equal(arch?.source, "apc");
    assert.equal(arch?.parent, "ceo");
    assert.equal(arch?.blob, "saturno");
    assert.deepEqual(arch?.model_choice, { model: "fake/fake-pro", router: true }, "v1's provider:model, routed");

    // The owner picks another model in APX; the file is edited; the owner's pick survives the reindex.
    await env.client.call("agents.update", {
      agent: "abc123def456-arch",
      model_choice: { model: "fake/fake-pro", router: false },
    });
    fs.writeFileSync(
      path.join(root, ".apc", "agents", "arch.md"),
      "---\nname: Arch\nrole: Principal Architect\n---\n\nSimple.\n",
    );
    fs.rmSync(path.join(root, ".apc", "agents", "ceo.md"));
    const s = await env.client.call("projects.sync", { project: "p_abc123def456" });
    assert.deepEqual(s, { projects: 1, agents: 1, archived: 1 });
    ({ agents } = await env.client.call("agents.list", {}));
    const again = agents.find((a) => a.id === "abc123def456-arch");
    assert.equal(again?.role, "Principal Architect");
    assert.deepEqual(again?.model_choice, { model: "fake/fake-pro", router: false });
    assert.ok(!agents.some((a) => a.id === "abc123def456-ceo"), "removed file → archived, not listed");

    // A project agent works with its project's AGENTS.md in context.
    await env.client.call("agents.update", { agent: "abc123def456-arch", model_choice: null });
    const t = await env.client.call("threads.create", { kind: "agent", agent_id: "abc123def456-arch" });
    assert.equal(t.project_id, "p_abc123def456");
    await env.client.call("threads.send", { thread: t.id, text: "hi" });
    const got = await env.settle(t.id);
    assert.deepEqual(got.messages.at(-1)?.parts, [{ type: "text", text: "saw AGENTS.md" }]);

    // A folder that is not an APC project is refused with a reason.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "apx-notapc-"));
    const err = await env.client.call("projects.register", { path: empty }).catch((e: unknown) => e);
    assert.ok(err instanceof ApxError && /not an APC project/.test(err.message));
    fs.rmSync(empty, { recursive: true, force: true });
  } finally {
    await env.core.close();
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("editing from APX writes the agent's file: create, edit, rename (same id) and archive (file moved, never deleted)", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-apcw-"));
  try {
    makeProject(root);
    fs.appendFileSync(path.join(root, ".apc", "agents", "arch.md"), "");
    // An unknown field another tool wrote must survive APX's edits.
    const archFile = path.join(root, ".apc", "agents", "arch.md");
    fs.writeFileSync(
      archFile,
      fs.readFileSync(archFile, "utf8").replace("icon: saturno", "icon: saturno\narea: engineering"),
    );
    await env.client.call("projects.register", { path: root });

    const made = await env.client.call("agents.create", {
      project_id: "p_abc123def456",
      slug: "qa",
      name: "Quinn",
      role: "QA lead: tests: everything",
      prompt: "Break things politely.",
    });
    assert.equal(made.id, "abc123def456-qa");
    const qaText = fs.readFileSync(path.join(root, ".apc", "agents", "qa.md"), "utf8");
    assert.match(qaText, /^---\nname: Quinn\nrole: "QA lead: tests: everything"\n---\n\nBreak things politely\.\n$/);

    await env.client.call("agents.update", {
      agent: "abc123def456-arch",
      role: "Chief Architect",
      prompt: "New body.",
    });
    const archText = fs.readFileSync(archFile, "utf8");
    assert.match(archText, /role: Chief Architect/);
    assert.match(archText, /area: engineering/, "unknown fields are kept");
    assert.match(archText, /\n\nNew body\.\n$/);

    const t = await env.client.call("threads.create", { kind: "agent", agent_id: "abc123def456-qa" });
    const renamed = await env.client.call("agents.update", { agent: "abc123def456-qa", slug: "quality" });
    assert.equal(renamed.id, "abc123def456-qa", "the id survives the rename");
    assert.equal(renamed.slug, "quality");
    assert.ok(fs.existsSync(path.join(root, ".apc", "agents", "quality.md")));
    assert.match(fs.readFileSync(path.join(root, ".apc", "agents", "quality.md"), "utf8"), /aliases: qa/);
    assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.agent_ids[0], "abc123def456-qa");

    await env.client.call("agents.update", { agent: "abc123def456-qa", parent: "arch" });
    await env.client.call("agents.create", {
      project_id: "p_abc123def456",
      slug: "intern",
      name: "Ivy",
      parent: "quality",
    });
    const gone = await env.client.call("agents.archive", { agent: "abc123def456-qa" });
    assert.match(gone.moved_to ?? "", /^\.apc\/agents\/\.archived\/quality-.*\.md$/);
    assert.ok(fs.existsSync(path.join(root, gone.moved_to ?? "")), "moved, not deleted");
    const { agents } = await env.client.call("agents.list", {});
    assert.ok(!agents.some((a) => a.id === "abc123def456-qa"));
    assert.equal(agents.find((a) => a.slug === "intern")?.parent, "arch", "its report moved up to its own parent");
    const s = await env.client.call("projects.sync", { project: "p_abc123def456" });
    assert.equal(s.agents, 3, "the archived file is not read back as an agent");
  } finally {
    await env.core.close();
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an archived agent is listed apart, comes back with its file, or is deleted for good keeping its name in old chats", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-apca-"));
  try {
    makeProject(root);
    await env.client.call("projects.register", { path: root });
    const id = "abc123def456-arch";
    const chat = await env.client.call("threads.create", { kind: "agent", agent_id: id });
    await env.client.call("memory.add", { scope: "agent", agent: id, text: "Prefers short specs" });
    assert.equal((await env.client.call("memory.list", { scope: "agent", agent: id })).memories.length, 1);
    await assert.rejects(env.client.call("agents.restore", { agent: id }), /not archived/);

    await env.client.call("agents.archive", { agent: id });
    const listed = await env.client.call("agents.archived", { project_id: "p_abc123def456" });
    assert.deepEqual(
      listed.agents.map((a) => a.id),
      [id],
    );
    assert.equal((await env.client.call("agents.archived", {})).agents.length, 1, "every project's, without a filter");

    // Back: its file returns, it is active again, with what the owner set in APX.
    const back = await env.client.call("agents.restore", { agent: id });
    assert.equal(back.name, "Arch");
    assert.ok(fs.existsSync(path.join(root, ".apc", "agents", "arch.md")));
    assert.ok((await env.client.call("agents.list", {})).agents.some((a) => a.id === id));
    assert.equal((await env.client.call("agents.archived", {})).agents.length, 0);

    // For good: only an archived one; its file and its own notes go, the chat still names it.
    await assert.rejects(env.client.call("agents.delete", { agent: id }), /not archived/);
    await env.client.call("agents.archive", { agent: id });
    await env.client.call("agents.delete", { agent: id });
    assert.deepEqual(fs.readdirSync(path.join(root, ".apc", "agents", ".archived")), []);
    assert.equal((await env.client.call("agents.archived", {})).agents.length, 0);
    assert.ok(!(await env.client.call("agents.list", {})).agents.some((a) => a.id === id));
    const notes = await env.client.call("memory.list", { scope: "agent", agent: id });
    assert.equal(notes.memories.length, 0);
    assert.equal((await env.client.call("threads.get", { thread: chat.id })).thread.agent_ids[0], id);
    assert.equal((await env.client.call("projects.sync", { project: "p_abc123def456" })).agents, 1);
  } finally {
    await env.core.close();
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("review fixes: an old slug can be reused after a rename; a clone with the same apx_id is its own project; symlinks are refused", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-apcr-"));
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "apx-apcc-"));
  try {
    makeProject(root);
    await env.client.call("projects.register", { path: root });
    await env.client.call("agents.update", { agent: "abc123def456-arch", slug: "architect" });
    const again = await env.client.call("agents.create", {
      project_id: "p_abc123def456",
      slug: "arch",
      name: "New Arch",
    });
    assert.notEqual(again.id, "abc123def456-arch", "a new agent, not the renamed one");
    const { agents } = await env.client.call("agents.list", {});
    assert.equal(agents.find((a) => a.id === "abc123def456-arch")?.slug, "architect");
    assert.equal(agents.find((a) => a.id === again.id)?.name, "New Arch");

    const report = await env.client.call("agents.create", {
      project_id: "p_abc123def456",
      slug: "drafter",
      name: "Drafter",
      parent: "architect",
    });
    await env.client.call("agents.update", { agent: "abc123def456-arch", slug: "lead" });
    const moved = (await env.client.call("agents.list", {})).agents.find((a) => a.id === report.id);
    assert.equal(moved?.parent, "lead", "a rename moves its reports along");

    makeProject(clone);
    const second = await env.client.call("projects.register", { path: clone });
    assert.notEqual(second.project.id, "p_abc123def456");
    const first = (await env.client.call("projects.list", {})).projects.find((p) => p.id === "p_abc123def456");
    assert.equal(first?.path, root, "the first folder keeps its project");

    const outside = path.join(os.tmpdir(), `apx-secret-${process.pid}.md`);
    fs.writeFileSync(outside, "---\nname: Leak\n---\n\nsecret\n");
    fs.symlinkSync(outside, path.join(root, ".apc", "agents", "leak.md"));
    await env.client.call("projects.sync", { project: "p_abc123def456" });
    assert.ok(
      !(await env.client.call("agents.list", {})).agents.some((a) => a.name === "Leak"),
      "a symlinked file is not read",
    );
    fs.rmSync(outside);
  } finally {
    await env.core.close();
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(clone, { recursive: true, force: true });
  }
});

test("an agent's tools and skills are set from APX: a project agent's file says them, a global agent keeps them", async () => {
  const llm = scriptedLlm((req) => say(`tools: ${req.tools.map((t) => t.function.name).join(",")}`));
  const env = await startCore({ llm });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-apct-"));
  try {
    makeProject(root);
    await env.client.call("projects.register", { path: root });
    const { tools } = await env.client.call("agents.tools", {});
    assert.deepEqual(
      tools.find((t) => t.name === "shell_output"),
      { name: "shell_output", group: "shell", kept: false, risk: "read" },
    );
    assert.equal(tools.find((t) => t.name === "recall")?.kept, true);
    assert.equal(tools.find((t) => t.name === "mcp_call")?.group, "mcp", "MCP's bridge is offered too");
    assert.ok(!tools.some((t) => t.name === "agent_set"), "the super-agent's own tools are not offered");

    await env.client.call("agents.update", {
      agent: "abc123def456-arch",
      tools: ["files", "web_read"],
      skills: ["pdf"],
    });
    const file = fs.readFileSync(path.join(root, ".apc", "agents", "arch.md"), "utf8");
    assert.match(file, /\ntools: files, web_read\n/);
    assert.match(file, /\nskills: pdf\n/);
    const arch = (await env.client.call("agents.list", {})).agents.find((a) => a.id === "abc123def456-arch");
    assert.deepEqual([arch?.tools, arch?.skills], [["files", "web_read"], ["pdf"]]);

    await env.client.call("agents.update", { agent: "abc123def456-arch", tools: [], skills: [] });
    assert.doesNotMatch(fs.readFileSync(path.join(root, ".apc", "agents", "arch.md"), "utf8"), /tools:|skills:/);

    await env.client.call("agents.create", { slug: "clerk", name: "Clerk" });
    await env.client.call("agents.update", { agent: "clerk", tools: ["web_search"] });
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "clerk" });
    await env.client.call("threads.send", { thread: t.id, text: "hi" });
    await env.settle(t.id);
    const offered = llm.calls.at(-1)?.tools.map((x) => x.function.name) ?? [];
    assert.ok(offered.includes("web_search") && !offered.includes("shell"), offered.join(","));
  } finally {
    await env.core.close();
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
