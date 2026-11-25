import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";

test("terminal jobs keep their agent and chat visible after the turn ends", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const thread = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Asset export",
    });
    const job = env.core.store.jobs.create({
      thread_id: thread.id,
      agent_id: "superagent",
      title: "render",
      cwd: ".",
      background: true,
    });
    const agent = env.core.store.agents.get("superagent");
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
    const caller = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Caller" });
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
    const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Audit" }))
      .id;
    const deadline_at = new Date(Date.now() + 60_000).toISOString();
    // `queued` runs are never picked up by the engine: they stay in the list as they are.
    const result = env.core.store.runs.create({
      thread_id: thread,
      agent_id: "superagent",
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
      agent_id: "superagent",
      trigger: "user",
      state: "queued",
      deadline_at,
      input: { text: "And the totals?", origin: { kind: "user" } },
    });
    const { running } = await env.client.call("jobs.list", { finished: 5 });
    const byId = new Map(running.map((j) => [j.id, j]));
    // The conversation it comes from opens there: no text of it.
    assert.deepEqual(byId.get(result.id)?.from, { kind: "delegation_result", name: "Scout", thread });
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
    const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Audit" }))
      .id;
    for (const text of ["first", "second"]) {
      await env.client.call("threads.send", { thread, text });
      await env.settle(thread);
    }
    // More runs than any page of the chat: older turns, one of them failed.
    const deadline_at = new Date(Date.now() + 60_000).toISOString();
    for (let i = 0; i < 25; i++) {
      const r = env.core.store.runs.create({
        thread_id: thread,
        agent_id: "superagent",
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

test("the owner's agents read and stop terminal jobs of any chat they may read; outsiders keep their own (D-271)", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    const { project: acme } = await env.client.call("projects.create", { name: "Acme" });
    const { project: northwind } = await env.client.call("projects.create", { name: "Northwind" });
    const { project: vault } = await env.client.call("projects.create", { name: "Vault" });
    const builder = await env.client.call("agents.create", {
      project_id: acme.id,
      slug: "builder",
      name: "Builder",
      role: "Developer",
    });
    const chat = (title: string, project_id: string, agent = builder.id) =>
      store.threads.create({ kind: "loose", title, agent_ids: [agent], project_id });
    const own = chat("Acme work", acme.id);
    // Chats it takes no part in: only D-271 lets it in.
    const other = chat("Northwind build", northwind.id, "superagent");
    const locked = chat("Vault build", vault.id, "superagent");
    store.projectProtection.protect("move_jobs", vault.id);
    const job = (thread: string) =>
      store.jobs.create({ thread_id: thread, agent_id: builder.id, title: "build", cwd: ".", background: true }).id;
    const ctx = (thread: string) => ({
      role: "operator" as const,
      actor: "agent" as const,
      transport: "internal" as const,
      session: undefined,
      log: createLog("test", true),
      agent: { id: builder.id, thread_id: thread, run_id: "run_test" },
    });
    const elsewhere = job(other.id);
    const read = await env.core.dispatch("jobs.get", { job: elsewhere }, ctx(own.id));
    assert.ok(read.ok, "an owner's agent reads another project's job");
    const stop = await env.core.dispatch("jobs.cancel", { job: elsewhere }, ctx(own.id), "stop-elsewhere");
    assert.ok(stop.ok, "and may stop it");
    const lockedJob = job(locked.id);
    assert.equal((await env.core.dispatch("jobs.get", { job: lockedJob }, ctx(own.id))).ok, false);
    assert.equal((await env.core.dispatch("jobs.cancel", { job: lockedJob }, ctx(own.id), "stop-locked")).ok, false);
    // A whole turn of another chat stays the owner's to stop.
    const run = store.runs.create({
      thread_id: other.id,
      agent_id: builder.id,
      trigger: "user",
      state: "queued",
      input: { text: "Build", origin: { kind: "user" } },
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal((await env.core.dispatch("jobs.cancel", { job: run.id }, ctx(own.id), "stop-run")).ok, false);
    // Calling from a chat that works for someone else: an outside app, a contact, a Flow bot.
    const client = chat("Outside app", acme.id);
    store.threads.mergeContext(client.id, { client: "external" });
    const bot = chat("Flow bot", acme.id);
    store.threads.mergeContext(bot.id, { flow_step: { delegate: false, bot: true } });
    const person = store.persons.create({ name: "Alex Acme", role: "contact" });
    const contact = store.threads.create({
      kind: "loose",
      title: "Alex",
      agent_ids: [builder.id],
      project_id: acme.id,
      channel: { id: "ch_test", conversation: "alex", person_id: person.id },
    });
    for (const from of [client, bot, contact]) {
      const refused = await env.core.dispatch("jobs.get", { job: elsewhere }, ctx(from.id));
      assert.equal(refused.ok, false, `${from.title} reads another chat's job`);
      assert.match(refused.ok ? "" : refused.error.message, /only read its own thread's jobs/);
      assert.equal(
        (await env.core.dispatch("jobs.cancel", { job: elsewhere }, ctx(from.id), `stop-${from.id}`)).ok,
        false,
      );
    }
    // Not even the owner's agents read a job of an outside app's chat.
    const sealed = chat("Outside app elsewhere", northwind.id, "superagent");
    store.threads.mergeContext(sealed.id, { client: "external" });
    assert.equal((await env.core.dispatch("jobs.get", { job: job(sealed.id) }, ctx(own.id))).ok, false);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
