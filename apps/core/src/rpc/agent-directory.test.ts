import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";

test("agent discovery exposes scope and the resolved project orchestrator without changing stored flags", async () => {
  const env = await startCore({
    llm: scriptedLlm((req, { said, afterTool }) =>
      afterTool
        ? say(String(req.messages.at(-1)?.content))
        : callTool("list", "list_agents", said === "all" ? {} : { query: said }),
    ),
  });
  try {
    const store = env.core.store;
    for (const id of ["marked", "role", "sole", "none", "optout"]) store.projects.upsert({ id, name: `Project ${id}` });
    const add = (project: string, slug: string, role: string, orchestrator?: boolean, parent?: string) => {
      const id = `${project}-${slug}`;
      store.agents.upsertApc({
        id,
        slug,
        name: slug,
        role,
        project_id: project,
        parent,
        prompt: "",
        extra: { orchestrator },
      });
      return id;
    };
    add("marked", "lead", "Lead", false);
    const head = add("marked", "coordinator", "Engineering", true);
    const worker = add("marked", "builder", "Engineering", undefined, "coordinator");
    add("role", "lead", "Orchestrator");
    add("role", "member", "Engineering", undefined, "lead");
    add("sole", "root", "Engineering");
    add("none", "first", "Engineering");
    add("none", "second", "Engineering");
    add("optout", "lead", "Lead orchestrator", false);
    const { agents } = await env.client.call("agents.list", {});
    const byId = new Map(agents.map((a) => [a.id, a]));
    assert.deepEqual(byId.get(worker)?.project_orchestrator, { id: head, name: "coordinator", selection: "marked" });
    assert.equal(byId.get(worker)?.scope, "project");
    assert.equal(byId.get(worker)?.project_name, "Project marked");
    assert.equal(byId.get(worker)?.is_orchestrator, false);
    assert.equal(byId.get(head)?.is_orchestrator, true);
    assert.equal(byId.get("marked-lead")?.orchestrator, false);
    assert.equal(byId.get("marked-lead")?.is_orchestrator, false);
    assert.equal(byId.get("role-lead")?.project_orchestrator?.selection, "role");
    assert.equal(byId.get("role-lead")?.orchestrator, undefined);
    assert.equal(byId.get("sole-root")?.project_orchestrator?.selection, "sole_head");
    for (const id of ["none-first", "none-second", "optout-lead"]) {
      assert.equal(byId.get(id)?.project_orchestrator, null);
      assert.equal(byId.get(id)?.is_orchestrator, false);
    }
    for (const id of ["roby", "vera"]) {
      assert.equal(byId.get(id)?.scope, "global");
      assert.equal(byId.get(id)?.project_name, null);
      assert.equal(byId.get(id)?.project_orchestrator, null);
      assert.equal(byId.get(id)?.is_orchestrator, false);
    }
    const listed = async (query: string) => {
      const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      await env.client.call("threads.send", { thread: thread.id, text: query });
      return texts((await env.settle(thread.id)).messages).at(-1) ?? "";
    };
    const all = await listed("all");
    assert.match(all, /Global: no fixed project.*Orchestrator: not applicable.*Is orchestrator: no/);
    assert.match(all, /Project none.*Orchestrator: none.*Is orchestrator: no/);
    assert.match(all, /id: marked-coordinator.*Is orchestrator: yes/);
    const found = await listed(worker);
    assert.match(
      found,
      /Project marked \(id: marked\).*Orchestrator: coordinator \(id: marked-coordinator, Explicit mark\).*Is orchestrator: no/,
    );
    assert.doesNotMatch(found, /Global: no fixed project/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an agent that names one teammate in list_agents reads its instructions too; a broad list does not", async () => {
  const env = await startCore({
    llm: scriptedLlm((req, { said, afterTool }) =>
      afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("list", "list_agents", { query: said }),
    ),
  });
  try {
    const store = env.core.store;
    store.projects.upsert({ id: "acme", name: "Acme" });
    for (const [slug, prompt] of [
      ["lead", "Split goals into tasks."],
      ["builder", "Work in a worktree and run the tests."],
    ] as const)
      store.agents.upsertApc({
        id: `acme-${slug}`,
        slug,
        name: slug,
        role: "Engineering",
        project_id: "acme",
        prompt,
        extra: {},
      });
    const listed = async (query: string) => {
      const thread = await env.client.call("threads.create", {
        kind: "loose",
        agent_id: "acme-lead",
        project_id: "acme",
      });
      await env.client.call("threads.send", { thread: thread.id, text: query });
      return texts((await env.settle(thread.id)).messages).at(-1) ?? "";
    };
    assert.match(await listed("acme-builder"), /Its instructions:\nWork in a worktree and run the tests\./);
    assert.doesNotMatch(await listed("Engineering"), /Its instructions/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a marked sub-team lead leads its reports, not the project; a parent by full id resolves", async () => {
  const env = await startCore({
    llm: scriptedLlm((req, { said, afterTool }) =>
      afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("list", "list_agents", { query: said }),
    ),
  });
  try {
    const store = env.core.store;
    store.projects.upsert({ id: "acme", name: "Acme" });
    const add = (slug: string, role: string, parent?: string, orchestrator?: boolean) => {
      store.agents.upsertApc({
        id: `acme-${slug}`,
        slug,
        name: slug,
        role,
        project_id: "acme",
        parent,
        prompt: "",
        extra: { orchestrator },
      });
      return `acme-${slug}`;
    };
    // The sub-team lead comes first, as files are read in name order: being marked must not make it the head.
    const sub = add("ada", "Video lead", "acme-reels", true);
    for (const w of ["w1", "w2", "w3"]) add(w, "Editor", "ada");
    const head = add("boss", "Director", undefined, true);
    const reels = add("reels", "Reels producer", "boss");
    const { agents } = await env.client.call("agents.list", {});
    const byId = new Map(agents.map((a) => [a.id, a]));
    for (const a of agents.filter((x) => x.project_id === "acme"))
      assert.deepEqual(a.project_orchestrator, { id: head, name: "boss", selection: "marked" }, a.id);
    assert.equal(byId.get(sub)?.is_orchestrator, false);
    assert.equal(byId.get(sub)?.orchestrator, true, "the stored mark is kept");
    assert.deepEqual(byId.get(sub)?.reports_to, { id: reels, name: "reels" }, "parent by full id");
    assert.deepEqual(byId.get(sub)?.leads, ["acme-w1", "acme-w2", "acme-w3"]);
    assert.equal(byId.get(head)?.reports_to, null);

    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "acme" });
    const out = texts((await env.settle(thread.id)).messages).at(-1) ?? "";
    assert.match(out, /id: acme-boss\).*Is orchestrator: yes/);
    assert.match(out, /id: acme-ada\).*Orchestrator: boss.*Is orchestrator: no · Leads its team \(3 reports\)/);
    assert.match(out, /id: acme-ada\).*Reports to: reels \(id: acme-reels\)/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
