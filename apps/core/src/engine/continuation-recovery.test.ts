import assert from "node:assert/strict";
import { test } from "node:test";
import { continuationCanStart, tickContinuations } from "./continuations.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const start = Date.parse("2026-10-05T10:00:00Z");
const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
const params = {
  thread: "home",
  purpose: "Read the report",
  condition: { kind: "time" as const, at: at(10) },
  expires_at: at(60),
};

async function fixture() {
  const llm = scriptedLlm(() => say("Read-only report."));
  const env = await startCore({ llm, clock: () => new Date(start) });
  return { ...env, llm };
}

test("an HTTP retry with the same idempotency key saves one request and one receipt", async () => {
  const f = await fixture();
  try {
    const [first, second] = await Promise.all([
      f.client.call("continuations.create", params, "same-followup"),
      f.client.call("continuations.create", params, "same-followup"),
    ]);
    assert.equal(first.id, second.id);
    assert.equal(f.core.store.continuations.list().length, 1);
    assert.equal(f.core.store.messages.notices("home", "continuation.receipt").length, 1);
  } finally {
    await f.core.close();
    await f.cleanup();
  }
});

test("catch-up stops after fifteen minutes even if the explicit expiry is later", async () => {
  const f = await fixture();
  try {
    const item = await f.client.call("continuations.create", params);
    let admissions = 0;
    tickContinuations(
      f.core.store,
      () => {
        admissions++;
        throw new Error("must not admit");
      },
      new Date(at(26)),
    );
    assert.equal(admissions, 0);
    assert.equal(f.core.store.continuations.get(item.id)?.value.state, "expired");
    assert.equal(f.llm.calls.length, 0);
  } finally {
    await f.core.close();
    await f.cleanup();
  }
});

test("a queued check revalidates the catch-up window before execution", async () => {
  const f = await fixture();
  try {
    const item = await f.client.call("continuations.create", params);
    const run = f.core.store.runs.create({
      thread_id: "home",
      agent_id: "superagent",
      trigger: "system",
      input: { origin: { kind: "continuation", id: item.id }, text: item.purpose },
      deadline_at: at(60),
    });
    f.core.store.continuations.change(item.id, "pending", "admitted", { run_id: run.id });
    assert.equal(continuationCanStart(f.core.store, run, new Date(at(10))), true);
    assert.equal(continuationCanStart(f.core.store, run, new Date(at(26))), false);
    assert.equal(f.llm.calls.length, 0);
  } finally {
    await f.core.close();
    await f.cleanup();
  }
});

test("changing the owner's channel destination blocks a saved request instead of retargeting it", async () => {
  const f = await fixture();
  try {
    const item = await f.client.call("continuations.create", params);
    f.core.store.threads.mergeContext("home", {
      reply_to: { channel: "another-channel", conversation: "another-chat" },
    });
    tickContinuations(
      f.core.store,
      () => {
        throw new Error("must not admit");
      },
      new Date(at(10)),
    );
    assert.equal(f.core.store.continuations.get(item.id)?.value.state, "blocked");
    assert.equal(f.llm.calls.length, 0);
  } finally {
    await f.core.close();
    await f.cleanup();
  }
});

test("an interrupted continuation is failed on restart and never replayed", async () => {
  const f = await fixture();
  let reopened: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    const item = await f.client.call("continuations.create", params);
    const run = f.core.store.runs.create({
      thread_id: "home",
      agent_id: "superagent",
      trigger: "system",
      input: { origin: { kind: "continuation", id: item.id }, text: item.purpose },
      deadline_at: at(60),
    });
    f.core.store.runs.setState(run, "working");
    f.core.store.continuations.change(item.id, "pending", "admitted", { run_id: run.id });
    await f.core.close();
    reopened = await startCore({ home: f.home, llm: f.llm, clock: () => new Date(at(11)) });
    reopened.core.scheduler.tick();
    assert.equal(reopened.core.store.continuations.get(item.id)?.value.state, "failed");
    assert.equal(reopened.core.store.runs.get(run.id)?.state, "failed");
    assert.equal((await reopened.client.call("threads.get", { thread: "home" })).runs.length, 1);
    assert.equal(f.llm.calls.length, 0);
  } finally {
    if (reopened) await reopened.core.close();
    await f.cleanup();
  }
});

test("failed admission leaves a visible blocker rather than a recurring retry", async () => {
  const f = await fixture();
  try {
    const item = await f.client.call("continuations.create", params);
    let admissions = 0;
    const admit = () => {
      admissions++;
      throw new Error("agent is unavailable");
    };
    tickContinuations(f.core.store, admit, new Date(at(10)));
    tickContinuations(f.core.store, admit, new Date(at(11)));
    assert.equal(admissions, 1);
    assert.equal(f.core.store.continuations.get(item.id)?.value.state, "blocked");
    const part = f.core.store.messages.notices("home", "continuation.receipt")[0]?.parts[0];
    assert.ok(part?.type === "notice" && part.vars?.reason === "unavailable");
  } finally {
    await f.core.close();
    await f.cleanup();
  }
});
