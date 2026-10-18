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
    env.cleanup();
  }
});
