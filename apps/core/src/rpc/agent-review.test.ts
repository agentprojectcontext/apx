import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { manualTimers, tempDir, waitFor } from "../testkit/platform.ts";

test("real core detects internal and external agent edits, rejects stale reviews and avoids apply loops", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const watchClock = manualTimers();
  const env = await startCore({ llm, projectWatchTimers: watchClock });
  const dir = tempDir("apx-agent-files-");
  try {
    const project = (await env.client.call("projects.register", { path: dir.path, init: true })).project;
    const made = await env.client.call("agents.create", {
      project_id: project.id,
      slug: "research",
      name: "Research",
      prompt: "Original instructions",
    });
    const queue = () => env.client.call("agents.review_queue", { project_id: project.id });
    await waitFor(async () => (await queue()).agents.length === 1, "creation review");
    const read = await env.client.call("agents.get", { agent: made.id });
    const file = path.join(dir.path, ".apc", "agents", "research.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Original instructions", "External instructions"));
    // Applying immediately, before the watch debounce, must re-read the external file.
    await assert.rejects(
      env.client.call("agents.update", { agent: made.id, prompt: "Stale proposal", if_revision: read.revision }),
      /changed since this review/,
    );
    assert.match(fs.readFileSync(file, "utf8"), /External instructions/);
    const current = await env.client.call("agents.get", { agent: made.id });
    await env.client.call("agents.update", {
      agent: made.id,
      prompt: "Reviewed instructions",
      if_revision: current.revision,
    });
    await waitFor(async () => (await queue()).agents.length === 0, "applied review clears queue");
    await env.client.call("projects.sync", { project: project.id });
    assert.equal((await queue()).agents.length, 0, "reindex does not requeue reviewed changes");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Reviewed instructions", "Another external edit"));
    await waitFor(() => watchClock.pending() > 0, "file watcher schedules its debounce");
    watchClock.tick(400);
    await waitFor(async () => (await queue()).agents.length === 1, "watcher review without explicit sync");
    const edited = await env.client.call("agents.get", { agent: made.id });
    assert.equal(edited.prompt, "Another external edit");
    await env.client.call("agents.review_ack", { agent: made.id, if_revision: edited.revision });
    assert.equal((await queue()).agents.length, 0);
    await assert.rejects(
      env.client.call("agents.review_ack", { agent: made.id, if_revision: current.revision }),
      /changed since this review/,
    );
    const global = await env.client.call("agents.create", {
      slug: "review-global",
      name: "Global",
      prompt: "Global role",
    });
    const clone = await env.client.call("agents.clone", { agents: [global.id], project_id: project.id, rename: true });
    assert.equal(clone.cloned.length, 1);
    await waitFor(async () => (await queue()).agents.length === 1, "cloned agent review");
    assert.equal(
      (await queue()).agents.some((a) => a.agent === global.id),
      false,
    );
    const installed = await env.client.call("agents.install", {
      project_id: project.id,
      templates: ["apx:product-team:security"],
    });
    assert.equal(installed.installed.length, 1);
    await waitFor(async () => (await queue()).agents.length === 2, "imported template review");
    assert.equal(llm.calls.length, 0, "detector makes no model calls");
  } finally {
    await env.core.close();
    await env.cleanup();
    await dir.remove();
  }
});

test("fresh and upgraded skill catalogs have one guide; the previous name still resolves", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const list = () => env.client.call("skills.list", {});
    assert.equal((await list()).skills.filter((s) => s.name === "apx-agents").length, 1);
    const old = path.join(env.home, "skills", "apx-agent-prompts");
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(
      path.join(old, "SKILL.md"),
      "---\nname: apx-agent-prompts\ndescription: Old instructions\n---\nOutdated\n",
    );
    env.core.store.settings.write("skills_off", { "*": ["apx-agent-prompts", "apx-agents"] });
    const skills = (await list()).skills;
    assert.equal(
      skills.some((s) => s.name === "apx-agent-prompts"),
      false,
    );
    assert.equal(skills.find((s) => s.name === "apx-agents")?.on, true);
    const loaded = await env.client.call("skills.get", { name: "apx-agent-prompts" });
    assert.equal(loaded.skill.name, "apx-agents");
    assert.match(loaded.content, /Before creating, editing, cloning or importing/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
