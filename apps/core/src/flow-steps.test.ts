// Switch checks, variables, code, SQL and command steps through the real executor (DECISIONS.md#d-170).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { FlowGraph, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { FLOW_COMMANDS_PER_HOUR } from "./flow-work-steps.ts";
import { tempDir, waitFor } from "./testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
const hook: FlowNode = { kind: "webhook", id: "start", label: "Webhook" };
const save = (id: string, value: Extract<FlowNode, { kind: "table_write" }>["value"]) =>
  ({ id, kind: "table_write", label: id, key: id, value }) as FlowNode;
const chain = (...nodes: FlowNode[]): FlowGraph => ({
  schemaVersion: 2,
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ source: nodes[i]?.id ?? "", target: n.id })),
  layout: [],
});
const cmd = (id: string, command: string, more: Partial<Extract<FlowNode, { kind: "cmd" }>> = {}): FlowNode => ({
  id,
  kind: "cmd",
  label: id,
  command,
  env: [],
  stdin: "",
  timeoutMs: 20000,
  continueOnError: false,
  ...more,
});
const sqlStep = (id: string, mode: "read" | "write", query: string, params: { name: string; value: string }[] = []) =>
  ({
    id,
    kind: "sql",
    label: id,
    database: "data/crm.db",
    mode,
    query,
    params,
    maxRows: 50,
    timeoutMs: 10000,
  }) as FlowNode;

/** A project, a Flow in it with this drawing published (approving what it shows) and turned on. */
async function publish(env: Env, id: string, graph: FlowGraph, setup?: (folder: string) => void) {
  const project = (await env.client.call("projects.create", { name: `Project ${id}` })).project.id;
  const folder = env.core.store.projects.get(project)?.path ?? "";
  assert.ok(folder && fs.existsSync(folder));
  setup?.(folder);
  await env.client.call("flows.set", {
    id,
    projectId: project,
    name: id,
    enabled: false,
    predicates: [],
    tableKey: "latest",
    action: { kind: "none" },
  });
  const draft = await env.client.call("flows.draft_save", { flow: id, expectedVersion: null, graph });
  const { issues } = await env.client.call("flows.validate", { flow: id, graph });
  assert.deepEqual(issues, []);
  const { keys } = await env.client.call("flows.outward", { flow: id, graph });
  await env.client.call("flows.publish", {
    flow: id,
    expectedDraftVersion: draft.draftVersion ?? 0,
    expectedPublishedRevision: null,
    outward: keys,
  });
  const flow = env.core.store.flows.get(id);
  assert.ok(flow);
  await env.client.call("flows.set", { ...flow, enabled: true });
  return { flow: id, folder, keys };
}
async function post(env: Env, flow: string, id: string, data: unknown) {
  const route = env.core.flows.routes(`/flows/${flow}`);
  assert.ok(route);
  return route.handle(
    {
      method: "POST",
      path: `/flows/${flow}`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ id, data })),
    },
    new AbortController().signal,
  );
}
const ended = (env: Env, flow: string, id: string) =>
  waitFor(
    () => env.core.store.flows.events(flow, 50).find((e) => e.event_id === id && e.state !== "pending"),
    `run ${id} to end`,
    { ms: 30_000 },
  );
const steps = (env: Env, flow: string, id: string) =>
  Object.fromEntries(env.core.store.flowGraphRuns.detail(flow, id)?.steps.map((s) => [s.node, s]) ?? []);
const out = (s: { output: string | null } | undefined) => JSON.parse(s?.output ?? "null");
const core = () => startCore({ llm: scriptedLlm(() => say("unused")) });

test("a switch takes the first case that holds, else otherwise; a yes/no drawing still reads as two cases", async () => {
  const env = await core();
  try {
    const check: FlowNode = {
      id: "tier",
      kind: "condition",
      label: "Tier",
      input: { kind: "event", path: ["tier"] },
      cases: [
        { id: "gold", label: "Gold", match: { kind: "equals", value: "gold" } },
        { id: "big", label: "Big order", match: { kind: "expr", expr: "$trigger.amount >= 100" } },
        { id: "c3", label: "Tagged", match: { kind: "expr", expr: `contains($trigger.tags, "vip")` } },
      ],
    };
    const event = { kind: "event" as const, path: [] };
    const graph: FlowGraph = {
      schemaVersion: 2,
      nodes: [hook, check, save("gold", event), save("big", event), save("vip", event), save("other", event)],
      edges: [
        { source: "start", target: "tier" },
        { source: "tier", target: "gold", when: "gold" },
        { source: "tier", target: "big", when: "big" },
        { source: "tier", target: "vip", when: "c3" },
        { source: "tier", target: "other", when: "no" },
      ],
      layout: [],
    };
    const { flow } = await publish(env, "switch", graph);
    const went = async (id: string, data: unknown) => {
      await post(env, flow, id, data);
      assert.equal((await ended(env, flow, id)).state, "succeeded");
      const s = steps(env, flow, id);
      return ["gold", "big", "vip", "other"].filter((n) => s[n]?.state === "succeeded");
    };
    assert.deepEqual(await went("a", { tier: "gold", amount: 500 }), ["gold"]);
    assert.deepEqual(await went("b", { tier: "free", amount: 150 }), ["big"]);
    assert.deepEqual(await went("c", { tier: "free", amount: 1, tags: ["vip"] }), ["vip"]);
    assert.deepEqual(await went("d", { tier: "free" }), ["other"]);
    assert.deepEqual(out(steps(env, flow, "d").tier), { case: "no" });

    // A check drawn before cases (one value, yes and no) runs as the same two cases, its record as before.
    const legacy: FlowNode = {
      id: "paid",
      kind: "condition",
      label: "Paid",
      input: { kind: "event", path: ["paid"] },
      equals: true,
    };
    const old: FlowGraph = {
      schemaVersion: 2,
      nodes: [hook, legacy, save("yes", event), save("no", event)],
      edges: [
        { source: "start", target: "paid" },
        { source: "paid", target: "yes" },
        { source: "paid", target: "no", when: "no" },
      ],
      layout: [],
    };
    const l = await publish(env, "legacy", old);
    for (const [id, paid, step] of [
      ["y", true, "yes"],
      ["n", false, "no"],
    ] as const) {
      await post(env, l.flow, id, { paid });
      assert.equal((await ended(env, l.flow, id)).state, "succeeded");
      const s = steps(env, l.flow, id);
      assert.equal(s[step]?.state, "succeeded");
      assert.deepEqual(out(s.paid), { matched: paid });
    }
    // A connection by a case the check doesn't have is refused; so is a case named like otherwise.
    const bad = await env.client.call("flows.validate", {
      flow: flow,
      graph: { ...graph, edges: [...graph.edges.slice(0, 4), { source: "tier", target: "other", when: "c9" }] },
    });
    assert.ok(bad.issues.some((i) => i.code === "branch_unknown"));
    const reserved = await env.client.call("flows.validate", {
      flow,
      graph: {
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === "tier" ? { ...check, cases: [{ id: "no", label: "", match: { kind: "equals", value: 1 } }] } : n,
        ),
      } as FlowGraph,
    });
    assert.ok(reserved.issues.some((i) => i.code === "case_reserved"));
    // Try a run says which way each check would go.
    const tried = await env.client.call("flows.try_graph", { graph, data: { tier: "free", amount: 120 } });
    assert.equal(tried.steps.find((s) => s.node === "tier")?.branch, "big");
    assert.equal(tried.steps.find((s) => s.node === "gold")?.state, "skipped");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("variables are set once and later steps read them as $vars, in expressions and in templates", async () => {
  const env = await core();
  try {
    const vars: FlowNode = {
      id: "set",
      kind: "vars",
      label: "Set",
      vars: [
        { name: "limit", value: { kind: "literal", value: 100 } },
        { name: "total", value: { kind: "expr", expr: "$trigger.price * $trigger.qty" } },
        { name: "big", value: { kind: "expr", expr: "$vars.total > $vars.limit" } },
      ],
    };
    const check: FlowNode = {
      id: "isBig",
      kind: "condition",
      label: "Big",
      input: { kind: "literal", value: null },
      cases: [{ id: "yes", label: "", match: { kind: "expr", expr: "$vars.big" } }],
    };
    const echo = cmd("echo", 'printf "%s" "$TOTAL"', { env: [{ name: "TOTAL", value: "$vars.total" }] });
    const graph: FlowGraph = {
      schemaVersion: 2,
      nodes: [hook, vars, check, echo],
      edges: [
        { source: "start", target: "set" },
        { source: "set", target: "isBig" },
        { source: "isBig", target: "echo", when: "yes" },
      ],
      layout: [],
    };
    const { flow } = await publish(env, "vars", graph);
    await post(env, flow, "e1", { price: 30, qty: 4 });
    assert.equal((await ended(env, flow, "e1")).state, "succeeded");
    const s = steps(env, flow, "e1");
    assert.deepEqual(out(s.set), { limit: 100, total: 120, big: true });
    assert.equal(out(s.echo).stdout, "120");
    await post(env, flow, "e2", { price: 1, qty: 1 });
    assert.equal((await ended(env, flow, "e2")).state, "succeeded");
    assert.equal(steps(env, flow, "e2").echo?.state, "skipped");
    // A variable set twice, or read before it is set, is refused before it runs.
    const twice = await env.client.call("flows.validate", {
      flow,
      graph: {
        ...graph,
        nodes: [...graph.nodes, { ...vars, id: "again" }],
        edges: [...graph.edges, { source: "start", target: "again" }],
      },
    });
    assert.ok(twice.issues.some((i) => i.code === "var_duplicate"));
    const order = await env.client.call("flows.validate", {
      flow,
      graph: {
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === "set"
            ? {
                ...vars,
                vars: [
                  { name: "a", value: { kind: "expr", expr: "$vars.b" } },
                  { name: "b", value: { kind: "literal", value: 1 } },
                ],
              }
            : n.id === "isBig"
              ? { ...check, cases: [{ id: "yes", label: "", match: { kind: "expr", expr: "$vars.a" } }] }
              : n,
        ),
      } as FlowGraph,
    });
    assert.ok(order.issues.some((i) => i.code === "var_order"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a code step returns JSON for the next ones; its error stops what follows", async () => {
  const env = await core();
  try {
    const js: FlowNode = {
      id: "score",
      kind: "js",
      label: "Score",
      code: "if (!input.email) throw new Error('no email'); return { score: input.email.length, domain: input.email.split('@')[1] }",
      input: { kind: "event", path: [] },
      timeoutMs: 5000,
    };
    const { flow } = await publish(
      env,
      "code",
      chain(hook, js, save("kept", { kind: "node", node: "score", path: ["domain"] })),
    );
    await post(env, flow, "ok", { email: "alex@example.com" });
    assert.equal((await ended(env, flow, "ok")).state, "succeeded");
    assert.deepEqual(out(steps(env, flow, "ok").score), { score: 16, domain: "example.com" });
    assert.deepEqual(out(steps(env, flow, "ok").kept), { value: "example.com" });
    await post(env, flow, "bad", { name: "no email" });
    assert.equal((await ended(env, flow, "bad")).state, "failed");
    const s = steps(env, flow, "bad");
    assert.equal(s.score?.error, "code_failed");
    assert.deepEqual(out(s.score), { error: "no email" });
    assert.equal(s.kept?.state, "blocked");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

function crm(folder: string) {
  fs.mkdirSync(path.join(folder, "data"), { recursive: true });
  const db = new DatabaseSync(path.join(folder, "data", "crm.db"));
  db.exec("CREATE TABLE leads (email TEXT PRIMARY KEY, name TEXT); INSERT INTO leads VALUES ('a@example.com', 'Alex')");
  db.close();
}
const leads = (folder: string) =>
  new DatabaseSync(path.join(folder, "data", "crm.db"), { readOnly: true })
    .prepare("SELECT * FROM leads ORDER BY email")
    .all()
    .map((r) => ({ ...r }));

test("SQL reads and writes the project's database with bound values; a write is allowed by publishing", async () => {
  const env = await core();
  try {
    const find = sqlStep("find", "read", "SELECT name FROM leads WHERE email = :email", [
      { name: "email", value: "$trigger.email" },
    ]);
    const add = sqlStep("add", "write", "INSERT INTO leads (email, name) VALUES (:email, :name)", [
      { name: "email", value: "$trigger.email" },
      { name: "name", value: "$trigger.name" },
    ]);
    const graph = chain(hook, find, add);
    const { flow, folder, keys } = await publish(env, "crm", graph, crm);
    assert.equal(keys.filter((k) => k.startsWith("write:")).length, 1);
    const evil = "x'); DROP TABLE leads; --";
    await post(env, flow, "e1", { email: evil, name: "Robert'); DELETE FROM leads; --" });
    assert.equal((await ended(env, flow, "e1")).state, "succeeded");
    const s = steps(env, flow, "e1");
    assert.deepEqual(out(s.find).rows, []);
    assert.equal(out(s.add).changes, 1);
    assert.deepEqual(leads(folder), [
      { email: "a@example.com", name: "Alex" },
      { email: evil, name: "Robert'); DELETE FROM leads; --" },
    ]);
    // The same email again: SQLite refuses it and says why; nothing was written, so the step failed, not "look".
    await post(env, flow, "e2", { email: "a@example.com", name: "Again" });
    assert.equal((await ended(env, flow, "e2")).state, "failed");
    assert.equal(steps(env, flow, "e2").add?.error, "query_failed");
    assert.match(out(steps(env, flow, "e2").add).error, /UNIQUE/);

    // Changing what a write does is a new approval.
    const draft = await env.client
      .call("flows.draft_save", {
        flow,
        expectedVersion: null,
        graph: chain(
          hook,
          find,
          sqlStep("add", "write", "DELETE FROM leads WHERE email = :email", [
            { name: "email", value: "$trigger.email" },
          ]),
        ),
      })
      .catch(async () => {
        const doc = await env.client.call("flows.graph_get", { flow });
        return env.client.call("flows.draft_save", {
          flow,
          expectedVersion: doc.draftVersion,
          graph: chain(
            hook,
            find,
            sqlStep("add", "write", "DELETE FROM leads WHERE email = :email", [
              { name: "email", value: "$trigger.email" },
            ]),
          ),
        });
      });
    await assert.rejects(
      env.client.call("flows.publish", {
        flow,
        expectedDraftVersion: draft.draftVersion ?? 0,
        expectedPublishedRevision: 1,
        outward: keys,
      }),
      /Confirm/,
    );
    // A database outside the project, or one that would climb out of it, never runs.
    for (const database of ["../crm.db", "/etc/hosts", "data/../../x.db", "~/x.db", "file:data/crm.db"]) {
      const { issues } = await env.client.call("flows.validate", {
        flow,
        graph: chain(hook, { ...find, database } as FlowNode),
      });
      assert.ok(
        issues.some((i) => i.code === "database_invalid" || i.code === "database_unavailable"),
        database,
      );
    }
    const link = path.join(folder, "data", "elsewhere.db");
    const outside = tempDir();
    fs.writeFileSync(path.join(outside.path, "x.db"), "");
    fs.symlinkSync(path.join(outside.path, "x.db"), link);
    const linked = await env.client.call("flows.validate", {
      flow,
      graph: chain(hook, { ...find, database: "data/elsewhere.db" } as FlowNode),
    });
    assert.ok(linked.issues.some((i) => i.code === "database_unavailable"));
    await outside.remove();
    const many = await env.client.call("flows.validate", {
      flow,
      graph: chain(hook, sqlStep("x", "read", "SELECT 1; DELETE FROM leads")),
    });
    assert.ok(many.issues.some((i) => i.code === "sql_statements"));
    const notRead = await env.client.call("flows.validate", {
      flow,
      graph: chain(hook, sqlStep("x", "read", "DELETE FROM leads")),
    });
    assert.ok(notRead.issues.some((i) => i.code === "sql_not_read"));
    const missing = await env.client.call("flows.validate", {
      flow,
      graph: chain(hook, sqlStep("x", "read", "SELECT * FROM leads WHERE email = :email")),
    });
    assert.ok(missing.issues.some((i) => i.code === "sql_param_missing"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a command gets what arrived only in its environment and input, never in its text", async () => {
  const env = await core();
  process.env.ACME_API_KEY = "sk-not-for-commands";
  try {
    const step = cmd("hello", 'printf "%s|" "$NAME"; cat; printf "|%s" "${ACME_API_KEY:-none}"; touch ran', {
      env: [{ name: "NAME", value: "$trigger.name" }],
      stdin: "note: $trigger.note",
    });
    const { flow, folder, keys } = await publish(env, "shell", chain(hook, step));
    assert.equal(keys.filter((k) => k.startsWith("cmd:")).length, 1);
    await post(env, flow, "e1", { name: "$(touch pwned); `touch pwned2`", note: "'; rm -rf . ; echo '" });
    assert.equal((await ended(env, flow, "e1")).state, "succeeded");
    const o = out(steps(env, flow, "e1").hello);
    assert.equal(o.stdout, "$(touch pwned); `touch pwned2`|note: '; rm -rf . ; echo '|none");
    assert.equal(o.exit, 0);
    assert.ok(fs.existsSync(path.join(folder, "ran")), "it runs in the project's folder");
    assert.ok(!fs.existsSync(path.join(folder, "pwned")) && !fs.existsSync(path.join(folder, "pwned2")));
    // Placeholders in the command's text, and variables that change how it runs, are refused.
    for (const [bad, code] of [
      [cmd("x", "echo $trigger.name"), "command_placeholder"],
      [cmd("x", "ls", { env: [{ name: "PATH", value: "/tmp" }] }), "env_refused"],
      [cmd("x", "ls", { env: [{ name: "LD_PRELOAD", value: "$trigger.lib" }] }), "env_refused"],
      [cmd("x", "ls", { env: [{ name: "node_options", value: "--require x" }] }), "env_refused"],
      [cmd("x", "ls", { env: [{ name: "BASH_ENV", value: "x" }] }), "env_refused"],
    ] as const) {
      const { issues } = await env.client.call("flows.validate", { flow, graph: chain(hook, bad) });
      assert.ok(
        issues.some((i) => i.code === code),
        `${code}: ${JSON.stringify(issues)}`,
      );
    }
  } finally {
    delete process.env.ACME_API_KEY;
    await env.core.close();
    await env.cleanup();
  }
});

test("a command's exit code: an error stops what follows unless the step lets a check read it", async () => {
  const env = await core();
  try {
    const event = { kind: "event" as const, path: [] };
    const strict = await publish(
      env,
      "strict",
      chain(hook, cmd("fail", "echo out; echo err >&2; exit 3"), save("after", event)),
    );
    await post(env, strict.flow, "e", { go: 1 });
    assert.equal((await ended(env, strict.flow, "e")).state, "failed");
    const s = steps(env, strict.flow, "e");
    assert.equal(s.fail?.error, "command_failed");
    assert.deepEqual(out(s.fail), { exit: 3, ok: false, stdout: "out\n", stderr: "err\n" });
    assert.equal(s.after?.state, "blocked");

    const check: FlowNode = {
      id: "code",
      kind: "condition",
      label: "Code",
      input: { kind: "node", node: "fail", path: ["exit"] },
      cases: [{ id: "yes", label: "Three", match: { kind: "equals", value: 3 } }],
    };
    const loose = await publish(env, "loose", {
      schemaVersion: 2,
      nodes: [hook, cmd("fail", "exit 3", { continueOnError: true }), check, save("three", event)],
      edges: [
        { source: "start", target: "fail" },
        { source: "fail", target: "code" },
        { source: "code", target: "three", when: "yes" },
      ],
      layout: [],
    });
    await post(env, loose.flow, "e", { go: 1 });
    assert.equal((await ended(env, loose.flow, "e")).state, "succeeded");
    assert.equal(steps(env, loose.flow, "e").three?.state, "succeeded");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a command past its time is stopped and left to look at; one cut by a restart never runs again", async () => {
  const home = tempDir();
  let env = await startCore({ home: home.path, llm: scriptedLlm(() => say("unused")) });
  try {
    const slow = await publish(env, "slow", chain(hook, cmd("wait", "sleep 30", { timeoutMs: 2000 })));
    await post(env, slow.flow, "e", { go: 1 });
    assert.equal((await ended(env, slow.flow, "e")).state, "uncertain");
    assert.equal(steps(env, slow.flow, "e").wait?.error, "command_timeout");

    const once = await publish(env, "once", chain(hook, cmd("mark", "echo run >> runs.txt; sleep 30")));
    await post(env, once.flow, "e", { go: 1 });
    const marks = path.join(once.folder, "runs.txt");
    await waitFor(() => fs.existsSync(marks), "the command to start");
    await env.core.close();
    env = await startCore({ home: home.path, llm: scriptedLlm(() => say("unused")) });
    assert.equal((await ended(env, once.flow, "e")).state, "uncertain");
    assert.equal(steps(env, once.flow, "e").mark?.error, "command_uncertain");
    assert.equal(fs.readFileSync(marks, "utf8"), "run\n", "it ran once, never again");
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
  }
});

test("commands have an hourly limit; one over it never starts", async () => {
  const env = await core();
  try {
    const { flow, folder } = await publish(env, "busy", chain(hook, cmd("mark", "echo x >> runs.txt")));
    const at = new Date();
    for (let i = 0; i < FLOW_COMMANDS_PER_HOUR; i++) env.core.store.flowSends.add(flow, "command", at);
    await post(env, flow, "e", { go: 1 });
    assert.equal((await ended(env, flow, "e")).state, "failed");
    assert.equal(steps(env, flow, "e").mark?.error, "command_limited");
    assert.ok(!fs.existsSync(path.join(folder, "runs.txt")));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
