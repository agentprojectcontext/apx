// An agent working for the owner may hand its own work on to a task in another project, and the brief says where it
// came from; an outside app's chat and a project being moved stay in place (DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { checkSelfHandoff, handoffBrief } from "./task-handoff.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("Ready.")) });
  env.core.store.projects.upsert({ id: "acme", name: "Acme" });
  env.core.store.projects.upsert({ id: "northwind", name: "Northwind" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** A chat in Acme with a turn of the super-agent still going. */
function turn(o: { app?: boolean } = {}) {
  const { store } = env.core;
  const source = store.threads.create({
    kind: "loose",
    title: "Source",
    agent_ids: ["superagent"],
    project_id: "acme",
  });
  if (o.app) store.threads.mergeContext(source.id, { client: "external" });
  const run = store.runs.create({
    thread_id: source.id,
    agent_id: "superagent",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "Fix the invoice export." },
    deadline_at: "9999-01-01T00:00:00Z",
  });
  const asker = {
    kind: "agent" as const,
    id: "superagent",
    name: "Roby",
    thread_id: source.id,
    run_id: run.id,
    depth: 1,
  };
  return { source, run, asker };
}

test("the owner's work hands off into another project, and the brief names where it came from", () => {
  const { store } = env.core;
  const { source, run, asker } = turn();
  assert.equal(checkSelfHandoff(store, asker, "northwind"), true);
  const target = store.threads.create({
    kind: "loose",
    title: "Target",
    agent_ids: ["superagent"],
    project_id: "northwind",
  });
  store.threads.mergeContext(target.id, { handoff_from: { thread: source.id, run: run.id } });
  assert.match(handoffBrief(store, target.id), /transferred from chat \S+ \(in project Acme\)/);
});

test("an outside app's chat keeps a self-handoff in its project, and its findings stay there", () => {
  const { store } = env.core;
  const { source, run, asker } = turn({ app: true });
  assert.throws(() => checkSelfHandoff(store, asker, "northwind"), /must stay in the current project/);
  const target = store.threads.create({
    kind: "loose",
    title: "Target",
    agent_ids: ["superagent"],
    project_id: "northwind",
  });
  store.threads.mergeContext(target.id, { handoff_from: { thread: source.id, run: run.id } });
  assert.equal(handoffBrief(store, target.id), "");
});

test("a project being moved is not handed work from outside it", () => {
  const { store } = env.core;
  const { asker } = turn();
  store.projectProtection.protect("mig_handoff", "northwind");
  try {
    assert.throws(() => checkSelfHandoff(store, asker, "northwind"), /must stay in the current project/);
  } finally {
    store.projectProtection.restore("mig_handoff");
  }
});
