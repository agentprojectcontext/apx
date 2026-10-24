import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const start = () => startCore({ llm: scriptedLlm(() => say("First step completed.")) });

test("create: optional preparation, dismissal and off never block execution or repeat questions", async () => {
  const env = await start();
  try {
    const { project } = await env.client.call("projects.create", { name: "Acme" });
    const off = await env.client.call("projects.helper_review", { project: project.id });
    assert.equal(off.enabled, false);
    assert.equal(off.offer, false);
    assert.deepEqual(off.missing, []);
    await env.client.call("projects.helper_set", { project: project.id, enabled: true });
    const review = await env.client.call("projects.helper_review", { project: project.id });
    assert.equal(review.offer, true);
    assert.deepEqual(review.missing, ["goal", "first_result"]);
    await env.client.call("projects.helper_set", { project: project.id, dismissed: review.fingerprint });
    assert.equal((await env.client.call("projects.helper_review", { project: project.id })).offer, false);
    const manual = await env.client.call("projects.helper_review", { project: project.id, manual: true });
    assert.deepEqual(manual.missing, ["goal", "first_result"]);
    await env.client.call("projects.helper_set", { project: project.id, enabled: false });
    assert.equal((await env.client.call("projects.helper_review", { project: project.id })).offer, false);
    assert.ok((await env.client.call("projects.helper_review", { project: project.id, manual: true })).brief);
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project.id });
    await env.client.call("threads.send", { thread: thread.id, text: "Start now without preparing a brief." });
    await env.settle(thread.id);
    assert.equal((await env.client.call("threads.get", { thread: thread.id })).messages.length, 2);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("existing context is reused silently; preparing a brief preserves project and team configuration", async () => {
  const env = await start();
  try {
    const { project } = await env.client.call("projects.create", {
      name: "Northwind",
      description: "Ship a small shop.",
    });
    const agent = await env.client.call("agents.create", {
      project_id: project.id,
      slug: "alex",
      name: "Alex",
      role: "Lead",
      prompt: "Keep these exact instructions.",
      orchestrator: true,
    });
    await env.client.call("projects.helper_set", {
      project: project.id,
      enabled: true,
      first_result: "A working checkout demo",
    });
    const before = await env.client.call("agents.get", { agent: agent.id });
    const files = fs.readdirSync(path.join(project.path ?? "", ".apc", "agents"));
    const contents = files.map((file) =>
      fs.readFileSync(path.join(project.path ?? "", ".apc", "agents", file), "utf8"),
    );
    const review = await env.client.call("projects.helper_review", { project: project.id, manual: true });
    assert.equal(review.offer, false);
    assert.deepEqual(review.missing, []);
    assert.equal(review.recipient, agent.id);
    assert.match(review.brief, /Ship a small shop/);
    assert.match(review.brief, /working checkout demo/);
    assert.match(review.brief, /no additional permissions/);
    assert.deepEqual(await env.client.call("agents.get", { agent: agent.id }), before);
    assert.deepEqual(
      files.map((file) => fs.readFileSync(path.join(project.path ?? "", ".apc", "agents", file), "utf8")),
      contents,
    );
    const thread = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: agent.id,
      project_id: project.id,
    });
    await env.client.call("threads.send", { thread: thread.id, text: review.brief });
    await env.settle(thread.id);
    assert.equal((await env.client.call("threads.get", { thread: thread.id })).messages.length, 2);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("manual agent review is available off, only proposes for empty prompts, and never creates an agent", async () => {
  const env = await start();
  try {
    const { project } = await env.client.call("projects.create", { name: "Acme", description: "Publish a catalog." });
    const before = env.core.store.agents.list();
    const proposal = await env.client.call("projects.helper_review", {
      project: project.id,
      manual: true,
      draft: { role: "Editor", prompt: "" },
    });
    assert.equal(proposal.enabled, false);
    assert.equal(proposal.offer, false);
    assert.ok(proposal.missing.includes("instructions"));
    assert.match(proposal.suggested_prompt ?? "", /Editor/);
    assert.match(proposal.suggested_prompt ?? "", /Publish a catalog/);
    const custom = await env.client.call("projects.helper_review", {
      project: project.id,
      manual: true,
      draft: { role: "Editor", prompt: "Never replace my custom prompt." },
    });
    assert.equal(custom.suggested_prompt, undefined);
    assert.ok(!custom.missing.includes("instructions"));
    assert.deepEqual(env.core.store.agents.list(), before);
    const created = await env.client.call("agents.create", {
      project_id: project.id,
      slug: "alex",
      name: "Alex",
      role: "Editor",
      prompt: "Never replace my custom prompt.",
    });
    assert.equal(env.core.store.agents.get(created.id)?.prompt, "Never replace my custom prompt.");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("imported conversations provide context without a new questionnaire or repeated import", async () => {
  const env = await start();
  try {
    const root = path.join(env.home, "acme");
    fs.mkdirSync(root);
    const dir = path.join(env.home, "claude-home", "projects", "-work-acme");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "s-catalog.jsonl"),
      `${JSON.stringify({ type: "user", cwd: root, sessionId: "s-catalog", message: { role: "user", content: "Build the product catalog" } })}\n`,
    );
    const imported = await env.client.call("sessions.import", { engine: "claude", cwd: root, extras: false });
    await env.client.call("projects.helper_set", { project: imported.project.id, enabled: true });
    const review = await env.client.call("projects.helper_review", { project: imported.project.id, manual: true });
    assert.equal(review.offer, false);
    assert.deepEqual(review.missing, []);
    assert.match(review.brief, /catalog/i);
    const again = await env.client.call("sessions.import", { engine: "claude", cwd: root, extras: false });
    assert.equal(again.project.id, imported.project.id);
    assert.equal((await env.client.call("projects.helper_review", { project: imported.project.id })).offer, false);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("helper settings reject invalid projects and cannot change permissions", async () => {
  const env = await start();
  try {
    await assert.rejects(env.client.call("projects.helper_review", { project: "missing" }), /project missing/);
    await assert.rejects(
      env.client.call("projects.helper_set", { project: "missing", enabled: true }),
      /project missing/,
    );
    const { project } = await env.client.call("projects.create", { name: "Acme" });
    await assert.rejects(
      env.client.call("projects.helper_set", { project: project.id, enabled: true, autonomy: "total" } as never),
      /invalid params/,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
