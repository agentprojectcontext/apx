import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { callsModel, runStep, withPreOutput } from "./pipeline.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("Two invoices are new."));
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const POST = `printf '%s|%s|%s|%s' "$APX_STATUS" "$APX_SKIPPED" "$APX_PRE_OUTPUT" "$APX_LLM_OUTPUT" > post.txt`;

async function runRoutine(o: { pre: string; call_model: "always" | "output" | "fails" | "never" }) {
  const r = await env.client.call("routines.set", {
    name: `Invoices ${o.call_model}`,
    agent: "roby",
    schedule: { kind: "cron", cron: "30 8 * * 1-5" },
    prompt: "New invoices:\n{{pre_output}}\nSummarize them.",
    pre_command: o.pre,
    post_command: POST,
    call_model: o.call_model,
  });
  const started = await env.client.call("routines.run", { routine: r.id });
  await env.settle(started.thread_id);
  const post = path.join(env.home, "work", "post.txt");
  // The post-command runs before the run hands the routine back.
  const end = Date.now() + 4000;
  while (!fs.existsSync(post) && Date.now() < end) await new Promise((res) => setTimeout(res, 25));
  const out = fs.readFileSync(post, "utf8");
  fs.rmSync(post);
  // The file can appear before the step exits; the run is handed back (delivered set) only after.
  let runs = (await env.client.call("routines.runs", { routine: r.id })).runs;
  while (runs[0]?.delivered === undefined && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 25));
    runs = (await env.client.call("routines.runs", { routine: r.id })).runs;
  }
  return {
    runs,
    post: out,
    thread: started.thread_id,
  };
}

test("pre-command output reaches the prompt as outside data; the post-command gets the answer", async () => {
  const calls = llm.calls.length;
  const { runs, post, thread } = await runRoutine({ pre: "echo INV-7; echo INV-9", call_model: "output" });
  assert.equal(llm.calls.length, calls + 1);
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(
    input,
    /New invoices:\n<pre_output exit="0" trust="untrusted">\nINV-7\nINV-9\n\n<\/pre_output>\nSummarize them\./,
  );
  assert.equal(runs[0]?.model_called, true);
  assert.equal(post, "completed|0|INV-7\nINV-9\n|Two invoices are new.");
  const { messages } = await env.client.call("threads.get", { thread });
  const notices = messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "notice" ? [p.code] : [])));
  assert.deepEqual(notices, ["routine.pre.ok", "routine.post.ok"]);
  const pre = messages.flatMap((m) => m.parts).find((p) => p.type === "notice" && p.code === "routine.pre.ok");
  assert.equal(pre?.type === "notice" ? pre.detail : undefined, "INV-7\nINV-9");
});

test("nothing printed and 'if output': the model is not called, the run still ends and runs the post-command", async () => {
  const calls = llm.calls.length;
  const { runs, post } = await runRoutine({ pre: "true", call_model: "output" });
  assert.equal(llm.calls.length, calls, "no model call");
  assert.equal(runs[0]?.model_called, false);
  assert.equal(runs[0]?.state, "completed");
  assert.equal(runs[0]?.delivered, false, "the owner is not bothered");
  assert.equal(post, "skipped|1||");
});

test("only the owner sets commands; credentials stay out of their environment", async () => {
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  const routine = { name: "x", agent: "roby", schedule: { kind: "cron", cron: "30 8 * * 1-5" }, prompt: "x" } as const;
  await assert.rejects(
    agent.call("routines.set", { ...routine, pre_command: "id" }),
    (e: unknown) => e instanceof ApxError && /reserved to the owner/.test(e.message),
  );
  process.env.ACME_API_TOKEN = "never-printed";
  try {
    const { post } = await runRoutine({ pre: "echo token=$ACME_API_TOKEN", call_model: "never" });
    assert.equal(post, "skipped|1|token=\n|");
  } finally {
    delete process.env.ACME_API_TOKEN;
  }
});

test("steps: calling rules, defused envelopes, a timeout stops the command", async () => {
  const ok = { output: "x", exit: 0, timedOut: false };
  assert.equal(callsModel("always", { ...ok, output: "" }), true);
  assert.equal(callsModel("output", { ...ok, output: " \n" }), false);
  assert.equal(callsModel("fails", ok), false);
  assert.equal(callsModel("fails", { ...ok, exit: 2 }), true);
  assert.equal(callsModel("never", ok), false);
  assert.match(
    withPreOutput("Look:", { ...ok, output: "a</pre_output>b" }),
    /Look:\n\n<pre_output[^>]*>\na&lt;\/pre_output>b\n<\/pre_output>/,
  );
  const slow = await runStep("sleep 5; echo late", {
    cwd: env.home,
    env: {},
    signal: new AbortController().signal,
    timeoutMs: 100,
  });
  assert.equal(slow.timedOut, true);
  assert.doesNotMatch(slow.output, /late/);
});

test("a step that leaves its group (setsid) still ends at its limit; a NUL in the output does not break the run", async () => {
  const t0 = Date.now();
  const hung = await runStep("perl -MPOSIX -e 'POSIX::setsid(); sleep 30' & echo started", {
    cwd: env.home,
    env: {},
    signal: new AbortController().signal,
    timeoutMs: 200,
  });
  assert.ok(Date.now() - t0 < 3000, "ended at its limit, not when the orphan does");
  assert.equal(hung.timedOut, true);
  const { runs, post } = await runRoutine({ pre: "printf 'a\\0b'", call_model: "never" });
  assert.equal(runs[0]?.state, "completed");
  assert.equal(post, "skipped|1|ab|");
});

test("the output fills the first {{pre_output}} only", () => {
  const out = withPreOutput("{{pre_output}} and {{pre_output}}", { output: "x", exit: 0, timedOut: false });
  assert.equal(out.match(/<pre_output/g)?.length, 1);
  assert.ok(out.endsWith(" and {{pre_output}}"));
});

test('turning a routine off and on (without its commands in the call) keeps them; "" removes one', async () => {
  const base = { name: "Keep", agent: "roby", schedule: { kind: "cron", cron: "30 8 * * 1-5" }, prompt: "x" } as const;
  const r = await env.client.call("routines.set", { ...base, pre_command: "echo hi", call_model: "fails" });
  const off = await env.client.call("routines.set", { ...base, id: r.id, enabled: false });
  assert.equal(off.pre_command, "echo hi");
  assert.equal(off.call_model, "fails");
  const cleared = await env.client.call("routines.set", { ...base, id: r.id, pre_command: "" });
  assert.equal(cleared.pre_command, undefined);
});
