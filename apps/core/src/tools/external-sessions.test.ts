import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";
import type { Harness, TurnIO } from "../harness/index.ts";
import { tempDir } from "../testkit/platform.ts";

const seen: TurnIO[] = [];
const approvals = new Map<string, boolean>();
const harness = (id: "claude" | "codex"): Harness => ({
  id,
  async run(io) {
    seen.push(io);
    if (String(io.input.content).includes("fail-session")) throw new Error("external engine is unavailable");
    if (String(io.input.content).includes("probe-write"))
      approvals.set(
        io.thread.id,
        await io.approve({
          callId: `${io.run.id}-edit`,
          title: "Edit a file",
          kind: "edit",
          input: { path: path.join(io.thread.cwd ?? "", "notes.txt") },
        }),
      );
    return { text: "review complete", model: `${id}/effective-model`, sessionId: `session-${io.thread.id}` };
  },
});
let args: Record<string, unknown> = {};
const llm = scriptedLlm((req, { said, afterTool }) =>
  said === "start it" && !afterTool
    ? callTool("session", "start_session", args)
    : say(String(req.messages.at(-1)?.content)),
);
let env: Awaited<ReturnType<typeof startCore>>;
const repo = tempDir("apx-external-");
let project: string;
before(async () => {
  env = await startCore({ llm, harnesses: { claude: harness("claude"), codex: harness("codex") } });
  project = (await env.client.call("projects.register", { path: repo.path, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await repo.remove();
});

async function start(
  options: Record<string, unknown> = {},
  write?: "ask" | "auto" | "read-only",
  decision?: "approve" | "deny",
  agent = "superagent",
  callerCwd?: string,
) {
  args = { engine: "claude", project, task: "review the change", ...options };
  const caller = await env.client.call("threads.create", {
    kind: callerCwd ? "code" : "loose",
    agent_id: agent,
    project_id: project,
    ...(callerCwd ? { cwd: callerCwd } : {}),
  });
  if (write) await env.client.call("threads.update", { thread: caller.id, write });
  await env.client.call("agents.update", { agent, autonomy: decision ? "auto" : "total" });
  await env.client.call("threads.send", { thread: caller.id, text: "start it" });
  if (decision) {
    const pending = await inputsOrEnd(env.client, caller.id);
    assert.equal(pending[0]?.tool, "start_session");
    await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision });
  }
  const done = await env.settle(caller.id);
  const step = done.runs.flatMap((r) => env.core.store.runs.steps(r.id)).find((s) => s.tool === "start_session");
  return { caller, done, result: step?.result ?? texts(done.messages).join("\n") };
}

test("the tool starts a visible external session on its engine default, linked to its caller", async () => {
  const { caller, result } = await start();
  const started = JSON.parse(result) as { thread: string; run: string; model: string };
  await env.settle(started.thread);
  const io = seen.find((s) => s.thread.id === started.thread);
  assert.deepEqual(io?.models, ["claude"]);
  assert.equal(io?.thread.parent_id, caller.id);
  assert.equal(io?.thread.kind, "code");
  assert.equal(io?.thread.cwd, repo.path);
  assert.equal(started.model, "default");
  const run = env.core.store.runs.get(started.run);
  assert.equal(run?.trigger, "a2a");
  assert.ok(run?.parent_run_id);
  assert.equal(run?.input?.origin.kind, "agent");
  assert.match(texts((await env.settle(caller.id)).messages).join("\n"), /review complete/);
  assert.ok((await env.client.call("threads.list", { engine: "claude" })).threads.some((t) => t.id === started.thread));
  for (const filter of [{}, { project_id: project }]) {
    const listed = (await env.client.call("threads.list", filter)).threads.find((t) => t.id === started.thread);
    assert.equal(listed?.project_id, project, "the external session is listed in its registered project");
    assert.equal(listed?.parent_id, caller.id, "listing keeps the async delivery and budget lineage");
  }
  assert.deepEqual(env.core.store.threads.context(started.thread).model_choice, { model: "claude", router: false });
});

test("an explicit model and reasoning effort reach the harness unchanged; another engine works too", async () => {
  for (const engine of ["claude", "codex"]) {
    const model = `${engine}/review-model#medium`;
    const { result } = await start({ engine, model, write: "read-only" });
    const started = JSON.parse(result) as { thread: string };
    await env.settle(started.thread);
    const io = seen.find((s) => s.thread.id === started.thread);
    assert.deepEqual(io?.models, [model]);
    assert.equal(io?.thread.write, "read-only");
    assert.deepEqual(env.core.store.threads.context(started.thread).model_choice, { model, router: false });
  }
});

test("mismatched models, missing projects, escaping folders and permission escalation create no session", async () => {
  const before = () => env.core.store.threads.list({ include_subthreads: true, engine: "claude", limit: null }).length;
  for (const [options, write, error] of [
    [{ model: "codex/review-model" }, undefined, /model must belong/],
    [{ project: "missing-project" }, undefined, /registered project/],
    [{ cwd: path.dirname(repo.path) }, undefined, /outside|inside|under/],
    [{ write: "auto" }, "read-only", /read-only/],
    [{ write: "auto" }, "ask", /write permission/],
  ] as const) {
    const count = before();
    assert.match((await start(options, write)).result, error);
    assert.equal(before(), count);
  }
});

test("the owner can decline starting an external engine, or approve it outside total mode", async () => {
  const count = seen.length;
  assert.match((await start({}, undefined, "deny")).result, /declined/);
  assert.equal(seen.length, count);
  const started = JSON.parse((await start({}, undefined, "approve")).result) as { thread: string };
  await env.settle(started.thread);
  assert.ok(seen.some((io) => io.thread.id === started.thread));
});

test("an external engine cannot edit from a read-only session", async () => {
  const started = JSON.parse((await start({ write: "read-only", task: "probe-write" })).result) as { thread: string };
  await env.settle(started.thread);
  assert.equal(approvals.get(started.thread), false);
});

test("a global caller in total mode cannot lift the destination project's write ceiling", async () => {
  try {
    for (const [autonomy, expected] of [
      ["manual", "ask"],
      ["plan", "read-only"],
    ] as const) {
      await env.client.call("projects.update", { project, autonomy });
      for (const engine of ["claude", "codex"]) {
        const started = JSON.parse((await start({ engine, write: "auto" })).result) as {
          thread: string;
          write: string;
        };
        await env.settle(started.thread);
        assert.equal(started.write, expected);
        assert.equal(seen.find((io) => io.thread.id === started.thread)?.thread.write, expected);
      }
      const readonly = JSON.parse((await start({ write: "read-only", task: "probe-write" })).result) as {
        thread: string;
      };
      await env.settle(readonly.thread);
      assert.equal(approvals.get(readonly.thread), false);
    }
  } finally {
    await env.client.call("projects.update", { project, autonomy: null });
  }
});

test("an engine failure stays visible in the external session instead of falling back to the native model", async () => {
  const started = JSON.parse((await start({ task: "fail-session" })).result) as { thread: string; run: string };
  await env.settle(started.thread);
  assert.equal(env.core.store.runs.get(started.run)?.state, "failed");
  assert.match(env.core.store.runs.get(started.run)?.error ?? "", /external engine is unavailable/);
  assert.equal(env.core.store.threads.get(started.thread)?.engine, "claude");
  assert.equal(seen.filter((s) => s.thread.id === started.thread).length, 1);
});

test("an external session keeps its caller's folder by default and refuses roots, siblings and symlink escapes", async () => {
  const scope = path.join(repo.path, "scoped");
  const sibling = path.join(repo.path, "sibling");
  const nested = path.join(scope, "nested");
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  const link = path.join(scope, "escape");
  fs.symlinkSync(sibling, link, process.platform === "win32" ? "junction" : "dir");
  for (const cwd of [repo.path, sibling, link]) {
    const count = seen.length;
    assert.match(
      (await start({ cwd, write: "read-only" }, undefined, undefined, "superagent", scope)).result,
      /caller's folder/,
    );
    assert.equal(seen.length, count);
  }
  for (const options of [{}, { cwd: nested }]) {
    const started = JSON.parse(
      (await start({ ...options, write: "read-only" }, undefined, undefined, "superagent", scope)).result,
    ) as { thread: string };
    await env.settle(started.thread);
    assert.equal(seen.find((s) => s.thread.id === started.thread)?.thread.cwd, options.cwd ?? scope);
  }
});

test("a project agent cannot launch a session in another project", async () => {
  const other = tempDir("apx-other-project-");
  try {
    const otherId = (await env.client.call("projects.register", { path: other.path, init: true })).project.id;
    env.core.store.agents.upsert({
      id: "scoped-reviewer",
      name: "Reviewer",
      role: "reviewer",
      kind: "agent",
      source: "local",
      project_id: project,
      prompt: "",
      browser_profile: "shared",
    });
    const count = seen.length;
    assert.match(
      (await start({ project: otherId }, undefined, undefined, "scoped-reviewer")).result,
      /another project/,
    );
    assert.equal(seen.length, count);
  } finally {
    await other.remove();
  }
});

test("the protocol rejects a model on an ordinary chat or one from another external engine", async () => {
  await assert.rejects(
    env.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      model: "claude/review-model",
    }),
    /external engine/,
  );
  await assert.rejects(
    env.client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      engine: "claude",
      project_id: project,
      model: "codex/review-model",
    }),
    /external engine/,
  );
});
