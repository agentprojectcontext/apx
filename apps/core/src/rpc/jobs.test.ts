import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("terminal jobs keep their agent and chat visible after the turn ends", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Asset export" });
    const job = env.core.store.jobs.create({
      thread_id: thread.id,
      agent_id: "roby",
      title: "render",
      cwd: ".",
      background: true,
    });
    const agent = env.core.store.agents.get("roby");
    for (const params of [{ finished: 5 }, { thread: thread.id, finished: 5 }]) {
      const list = await env.client.call("jobs.list", params);
      assert.equal(list.running.find((j) => j.id === job.id)?.thread_title, "Asset export");
      assert.equal(list.running.find((j) => j.id === job.id)?.agent_name, agent?.name);
    }
    env.core.store.jobs.finish(job.id, "completed", 0);
    const result = await env.client.call("jobs.get", { job: job.id });
    assert.equal(result.job.thread_title, "Asset export");
    assert.equal(result.job.agent_name, agent?.name);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("terminal provenance follows the executor and its project, never the caller or chat participants", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { project } = await env.client.call("projects.create", { name: "Northwind" });
    const { project: movedProject } = await env.client.call("projects.create", { name: "Acme" });
    const agent = await env.client.call("agents.create", {
      project_id: movedProject.id,
      slug: "builder",
      name: "Builder",
      role: "Developer",
    });
    const caller = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Caller" });
    const executor = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: agent.id,
      project_id: project.id,
      title: "Build catalog",
    });
    const run = env.core.store.runs.create({
      thread_id: executor.id,
      agent_id: agent.id,
      trigger: "a2a",
      state: "queued",
      input: { text: "Build the catalog", origin: { kind: "user" } },
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    env.core.store.runs.setState(run, "submitted");
    await env.client.call("threads.send", { thread: executor.id, text: "Continue" });
    await env.settle(executor.id);
    const job = env.core.store.jobs.create({
      thread_id: executor.id,
      run_id: run.id,
      agent_id: agent.id,
      title: "build",
      cwd: ".",
      background: true,
    });
    const legacy = env.core.store.jobs.create({
      thread_id: caller.id,
      title: "legacy",
      cwd: ".",
      background: true,
    });
    const recovered = env.core.store.jobs.create({
      thread_id: executor.id,
      run_id: run.id,
      title: "recovered",
      cwd: ".",
      background: true,
    });
    const mismatch = env.core.store.jobs.create({
      thread_id: caller.id,
      run_id: run.id,
      title: "mismatch",
      cwd: ".",
      background: true,
    });
    env.core.store.threads.moveTo(executor.id, movedProject.id);
    for (const params of [{ finished: 5 }, { thread: executor.id, finished: 5 }]) {
      const listed = (await env.client.call("jobs.list", params)).running.find((j) => j.id === job.id);
      assert.equal(listed?.agent_id, agent.id);
      assert.equal(listed?.agent_name, "Builder");
      assert.equal(listed?.project_id, project.id);
      assert.equal(listed?.project_name, "Northwind", "the executing project's snapshot survives a chat move");
      assert.equal(listed?.thread_project_id, movedProject.id);
      assert.equal(listed?.thread_project_name, "Acme");
      assert.equal(listed?.run_id, run.id);
    }
    for (const id of [job.id, recovered.id]) {
      const { job: read } = await env.client.call("jobs.get", { job: id });
      assert.equal(read.agent_name, "Builder");
      assert.equal(read.project_name, "Northwind");
      assert.equal(read.thread_title, "Build catalog");
    }
    for (const id of [legacy.id, mismatch.id]) {
      const { job: read } = await env.client.call("jobs.get", { job: id });
      assert.equal(read.agent_id, undefined, "participants and unrelated runs are not executors");
      assert.equal(read.agent_name, undefined);
      assert.equal(read.project_id, undefined, "a current chat project is not historical evidence");
    }
    const agentJobs = await env.client.call("jobs.list", { finished: 10 });
    const agentJob = agentJobs.finished.find((j) => j.id === run.id);
    assert.equal(agentJob?.project_name, "Northwind");
    assert.equal(agentJob?.thread_project_name, "Acme");
    assert.equal(
      (await env.client.call("jobs.list", { thread: caller.id, finished: 5 })).running.some((j) => j.id === job.id),
      false,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("execution snapshots the current project after queueing, including the agent fallback", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { project: before } = await env.client.call("projects.create", { name: "Acme" });
    const { project: after } = await env.client.call("projects.create", { name: "Northwind" });
    const agent = await env.client.call("agents.create", {
      project_id: after.id,
      slug: "builder",
      name: "Builder",
      role: "Developer",
    });
    for (const withProject of [true, false]) {
      const thread = await env.client.call("threads.create", {
        kind: "loose",
        agent_id: agent.id,
        ...(withProject ? { project_id: before.id } : {}),
      });
      const run = env.core.store.runs.create({
        thread_id: thread.id,
        agent_id: agent.id,
        trigger: "user",
        state: "queued",
        input: { text: "Build", origin: { kind: "user" } },
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
      });
      if (withProject) env.core.store.threads.moveTo(thread.id, after.id);
      env.core.store.runs.setState(run, "submitted");
      await env.client.call("threads.send", { thread: thread.id, text: "Continue" });
      await env.settle(thread.id);
      const job = env.core.store.jobs.create({
        thread_id: thread.id,
        run_id: run.id,
        agent_id: agent.id,
        title: "build",
        cwd: ".",
        background: true,
      });
      env.core.store.threads.moveTo(thread.id, before.id);
      const read = await env.client.call("jobs.get", { job: job.id });
      assert.equal(read.job.project_name, "Northwind");
      assert.equal(read.job.project_id, after.id);
      assert.equal(read.job.thread_project_name, "Acme");
    }
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("jobs.list names what each queued turn carries, never its text", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Audit" })).id;
    const deadline_at = new Date(Date.now() + 60_000).toISOString();
    // `queued` runs are never picked up by the engine: they stay in the list as they are.
    const result = env.core.store.runs.create({
      thread_id: thread,
      agent_id: "roby",
      trigger: "a2a_result",
      state: "queued",
      deadline_at,
      input: {
        text: "Part checked.",
        origin: {
          kind: "delegation_result",
          agent_id: "scout",
          name: "Scout",
          thread_id: thread,
          run_id: "run_x",
          state: "completed",
        },
      },
    });
    const owner = env.core.store.runs.create({
      thread_id: thread,
      agent_id: "roby",
      trigger: "user",
      state: "queued",
      deadline_at,
      input: { text: "And the totals?", origin: { kind: "user" } },
    });
    const { running } = await env.client.call("jobs.list", { finished: 5 });
    const byId = new Map(running.map((j) => [j.id, j]));
    assert.deepEqual(byId.get(result.id)?.from, { kind: "delegation_result", name: "Scout" });
    assert.deepEqual(byId.get(owner.id)?.from, { kind: "user" });
    assert.ok(!JSON.stringify(running).includes("Part checked."));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("usage.summary of a chat totals every run it kept, not the newest page an app loads", async () => {
  const env = await startCore({
    llm: scriptedLlm(() => ({ ...say("ok"), usage: { input: 1000, output: 50, cached: 600 } })),
  });
  try {
    const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Audit" })).id;
    for (const text of ["first", "second"]) {
      await env.client.call("threads.send", { thread, text });
      await env.settle(thread);
    }
    // More runs than any page of the chat: older turns, one of them failed.
    const deadline_at = new Date(Date.now() + 60_000).toISOString();
    for (let i = 0; i < 25; i++) {
      const r = env.core.store.runs.create({
        thread_id: thread,
        agent_id: "roby",
        trigger: "user",
        deadline_at,
        input: { text: `turn ${i}`, origin: { kind: "user" } },
      });
      env.core.store.runs.patch(r, { model: "fake/fake-1", usage: { input: 10, output: 2 } });
      env.core.store.runs.setState(r, i === 0 ? "failed" : "completed", i === 0 ? "boom" : undefined);
    }
    const { totals } = await env.client.call("usage.summary", { thread });
    assert.ok(totals);
    assert.equal(totals.runs, 27);
    assert.equal(totals.failed, 1);
    assert.equal(totals.input, 2 * 1000 + 25 * 10);
    assert.equal(totals.output, 2 * 50 + 25 * 2);
    assert.equal(totals.cached, 2 * 600, "the provider's cache reads are kept, inside input");
    assert.ok(totals.seconds >= 0);
    assert.equal((await env.client.call("usage.summary", {})).totals, undefined, "only a chat's summary has totals");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
