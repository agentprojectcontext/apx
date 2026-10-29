// A project's named tables and variables holding a secret, through the real executor (DECISIONS.md#d-173).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowGraph, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import { openDb } from "./db/db.ts";
import { flowTablesRepo } from "./domain/flow-tables.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { tempDir, waitFor } from "./testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
type Node<K extends FlowNode["kind"]> = Extract<FlowNode, { kind: K }>;
const hook: FlowNode = { kind: "webhook", id: "start", label: "Webhook" };
const event = { kind: "event" as const, path: [] };
const chain = (...nodes: FlowNode[]): FlowGraph => ({
  schemaVersion: 2,
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ source: nodes[i]?.id ?? "", target: n.id })),
  layout: [],
});
const save = (id: string, more: Partial<Node<"table_write">> = {}): FlowNode => ({
  id,
  kind: "table_write",
  label: id,
  table: "leads",
  key: "$trigger.email",
  value: event,
  ...more,
});
const read = (id: string, more: Partial<Node<"table_read">> = {}): FlowNode => ({
  id,
  kind: "table_read",
  label: id,
  table: "leads",
  keys: [],
  ...more,
});
const vars = (value: string): FlowNode => ({
  id: "set",
  kind: "vars",
  label: "Set",
  vars: [{ name: "token", value: { kind: "literal", value } }],
});
const cmd = (env: { name: string; value: string }[], stdin = ""): FlowNode => ({
  id: "call",
  kind: "cmd",
  label: "Call",
  command: 'printf "%s" "$KEY"',
  env,
  stdin,
  timeoutMs: 20000,
  continueOnError: false,
});

/** A project with an empty `leads` table, the one the steps here name. */
async function project(env: Env, name: string) {
  const id = (await env.client.call("projects.create", { name })).project.id;
  await env.client.call("tables.create", { project: id, name: "leads" });
  return id;
}
/** A Flow in `projectId` with this drawing published (approving what it shows) and turned on. */
async function publish(env: Env, id: string, projectId: string, graph: FlowGraph) {
  await env.client.call("flows.set", {
    id,
    projectId,
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
}
async function post(env: Env, flow: string, id: string, data: unknown) {
  const route = env.core.flows.routes(`/flows/${flow}`);
  assert.ok(route);
  await route.handle(
    {
      method: "POST",
      path: `/flows/${flow}`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ id, data })),
    },
    new AbortController().signal,
  );
  return waitFor(
    () => env.core.store.flows.events(flow, 50).find((e) => e.event_id === id && e.state !== "pending"),
    `run ${id} to end`,
    { ms: 30_000 },
  );
}
const output = (env: Env, flow: string, id: string, node: string) =>
  JSON.parse(env.core.store.flowGraphRuns.detail(flow, id)?.steps.find((s) => s.node === node)?.output ?? "null");
const core = () => startCore({ llm: scriptedLlm(() => say("unused")) });
const issuesOf = async (env: Env, flow: string, graph: FlowGraph) =>
  (await env.client.call("flows.validate", { flow, graph })).issues.map((i) => i.code);

test("a save names its table and fills its key; a read in the same run gets that key or the latest rows", async () => {
  const env = await core();
  try {
    const p = await project(env, "Acme leads");
    await publish(
      env,
      "leads",
      p,
      chain(hook, save("keep"), read("one", { keys: ["$trigger.email"] }), read("last", { latest: 5 })),
    );
    assert.equal((await post(env, "leads", "e1", { email: "alex@example.com", n: 1 })).state, "succeeded");
    assert.deepEqual(output(env, "leads", "e1", "keep"), {
      key: "alex@example.com",
      value: { email: "alex@example.com", n: 1 },
    });
    assert.deepEqual(output(env, "leads", "e1", "one").row, { email: "alex@example.com", n: 1 });
    await post(env, "leads", "e2", { email: "sam@example.com", n: 2 });
    // Saving under a key again replaces its row: still two rows, the newest first.
    await post(env, "leads", "e3", { email: "alex@example.com", n: 3 });
    const last = output(env, "leads", "e3", "last").rows as { key: string; value: { n: number } }[];
    assert.deepEqual(
      last.map((r) => [r.key, r.value.n]),
      [
        ["alex@example.com", 3],
        ["sam@example.com", 2],
      ],
    );
    const { tables } = await env.client.call("tables.list", { project: p });
    assert.deepEqual(
      tables.map((t) => [t.name, t.rows, t.columns]),
      [["leads", 2, ["email", "n"]]],
    );
    const page = await env.client.call("tables.get", { project: p, table: "leads", limit: 1 });
    assert.equal(page.rows[0]?.key, "alex@example.com");
    assert.ok(page.nextCursor);
    const next = await env.client.call("tables.get", {
      project: p,
      table: "leads",
      limit: 1,
      cursor: page.nextCursor,
    });
    assert.deepEqual(
      next.rows.map((r) => r.key),
      ["sam@example.com"],
    );
    // A key whose field did not arrive fails the save; nothing is written.
    assert.equal((await post(env, "leads", "e4", { n: 4 })).state, "failed");
    assert.equal((await env.client.call("tables.list", { project: p })).tables[0]?.rows, 2);
    // Another project's tables are its own.
    const other = await project(env, "Northwind");
    assert.equal((await env.client.call("tables.get", { project: other, table: "leads" })).rows.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a read says what it reads: one key or the latest rows of a named table", async () => {
  const env = await core();
  try {
    await publish(env, "reads", await project(env, "Acme"), chain(hook, save("keep")));
    // A read that names nothing to read is a step still to finish (DECISIONS.md#d-177).
    assert.ok((await issuesOf(env, "reads", chain(hook, read("r")))).includes("step_incomplete"));
    assert.ok((await issuesOf(env, "reads", chain(hook, read("r", { keys: ["a"], latest: 3 })))).includes("read_what"));
    const own: FlowNode = { id: "r", kind: "table_read", label: "r", keys: [], latest: 3 };
    assert.ok((await issuesOf(env, "reads", chain(hook, own))).includes("read_table"));
    assert.deepEqual(await issuesOf(env, "reads", chain(hook, save("s", { key: "fixed" }))), []);
    assert.ok((await issuesOf(env, "reads", chain(hook, save("s", { key: "$steps.nobody.x" })))).length > 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a table holds keys of one line and at most 1000 rows; the project lists each with its count", () => {
  const temp = tempDir();
  const db = openDb(temp.path);
  try {
    db.prepare("INSERT INTO projects(id, name, created_at) VALUES ('p', 'Acme', '2026-01-01')").run();
    const tables = flowTablesRepo(db);
    tables.create("p", "t");
    tables.create("p", "u");
    assert.throws(() => tables.write("p", "t", "two\nlines", 1), /key/);
    assert.throws(() => tables.write("p", "t", " ", 1), /key/);
    for (let i = 0; i < 1000; i++) tables.write("p", "t", `k${i}`, i);
    assert.throws(() => tables.write("p", "t", "one more", 1), /full/);
    tables.write("p", "t", "k1", "again");
    tables.write("p", "u", "only", true);
    assert.deepEqual(
      tables
        .list("p")
        .map((t) => [t.name, t.rows])
        .sort(),
      [
        ["t", 1000],
        ["u", 1],
      ],
    );
    assert.deepEqual(tables.read("p", "t", ["k1", "nope"]), { k1: "again" });
  } finally {
    db.close();
    temp.remove();
  }
});

test("a variable holding a secret is read only in a command's environment; elsewhere it is refused", async () => {
  const env = await core();
  const SECRET = "sk-flow-var-0123456789abcdef";
  try {
    await env.client.call("secrets.set", { name: "acme_key", value: SECRET });
    const p = await project(env, "Acme secrets");
    const graph = chain(hook, vars("secret://acme_key"), cmd([{ name: "KEY", value: "Bearer $vars.token" }]));
    await publish(env, "secret-var", p, graph);
    const { commands } = await env.client.call("flows.outward", { flow: "secret-var", graph });
    assert.deepEqual(commands[0]?.secrets, ["acme_key"], "the allow dialog names the secret the variable holds");
    assert.equal((await post(env, "secret-var", "e1", { go: true })).state, "succeeded");
    assert.equal(output(env, "secret-var", "e1", "call").stdout, "Bearer [secret]");
    assert.ok(!JSON.stringify(env.core.store.flowGraphRuns.detail("secret-var", "e1")).includes(SECRET));
    // In a command's input, a message or a key it would travel as text: refused, with the variable named.
    const leaks = await env.client.call("flows.validate", {
      flow: "secret-var",
      graph: chain(hook, vars("secret://acme_key"), cmd([], "$vars.token")),
    });
    assert.ok(leaks.issues.some((i) => i.code === "secret_var_text" && i.message.includes("$vars.token")));
    assert.ok(
      (
        await issuesOf(env, "secret-var", chain(hook, vars("secret://acme_key"), save("s", { key: "$vars.token" })))
      ).includes("secret_var_text"),
    );
    // A secret beside other text is not a reference: it would be read as plain text.
    assert.ok(
      (await issuesOf(env, "secret-var", chain(hook, vars("Bearer secret://acme_key")))).includes("secret_var_shape"),
    );
    // A secret the variable names that is not in Secrets is said before publishing.
    const missing = chain(hook, vars("secret://nobody"), cmd([{ name: "KEY", value: "$vars.token" }]));
    assert.ok((await issuesOf(env, "secret-var", missing)).includes("secret_missing"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

const twoVars = (): FlowNode => ({
  id: "set",
  kind: "vars",
  label: "Set",
  vars: [
    { name: "token", value: { kind: "literal", value: "secret://acme_key" } },
    { name: "plain", value: { kind: "literal", value: "p" } },
  ],
});

test("a secret variable is swapped once the text is parsed: a placeholder before it never swallows it", async () => {
  const env = await core();
  const SECRET = "sk-flow-var-parse-0123456789abcdef";
  try {
    await env.client.call("secrets.set", { name: "acme_key", value: SECRET });
    const p = await project(env, "Acme parse");
    const step: Node<"cmd"> = {
      ...(cmd([
        { name: "KEY", value: "$trigger.x$vars.token" },
        { name: "TWO", value: "$vars.plain$vars.token" },
      ]) as Node<"cmd">),
      command: 'printf "%s|%s" "$KEY" "$TWO"',
    };
    const graph = chain(hook, twoVars(), step);
    await publish(env, "parse-first", p, graph);
    const { commands } = await env.client.call("flows.outward", { flow: "parse-first", graph });
    assert.deepEqual(commands[0]?.secrets, ["acme_key"]);
    assert.equal((await post(env, "parse-first", "e1", { x: "a" })).state, "succeeded");
    assert.equal(output(env, "parse-first", "e1", "call").stdout, "a[secret]|p[secret]");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a secret variable followed by a dot, or read as a field, is still refused where it would leave as text", async () => {
  const env = await core();
  try {
    await publish(env, "dots", await project(env, "Acme dots"), chain(hook, save("keep")));
    const notify: FlowNode = {
      id: "tell",
      kind: "notify",
      label: "Tell",
      channel: "telegram",
      to: { kind: "contact", person: "owner" },
      text: "Your key is $vars.token.",
      onlyIfContent: false,
    };
    assert.ok((await issuesOf(env, "dots", chain(hook, twoVars(), notify))).includes("secret_var_text"));
    assert.ok(
      (await issuesOf(env, "dots", chain(hook, twoVars(), cmd([], "$vars.token.x")))).includes("secret_var_text"),
    );
    // In a command's variable it is fine, dot or not after it: the dot is the owner's text.
    assert.ok(
      !(await issuesOf(env, "dots", chain(hook, twoVars(), cmd([{ name: "KEY", value: "$vars.token." }])))).includes(
        "secret_var_text",
      ),
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("no step receives a secret variable as its input, and code never sees one among its variables", async () => {
  const env = await core();
  try {
    const p = await project(env, "Acme inputs");
    const set = { kind: "node" as const, node: "set", path: [] as string[] };
    const js = (input: typeof set): FlowNode => ({
      id: "code",
      kind: "js",
      label: "Code",
      code: "return vars;",
      input,
      timeoutMs: 2000,
    });
    const agent: FlowNode = { id: "ask", kind: "agent", label: "Ask", agent: "roby", prompt: "Go", input: set };
    const routine: FlowNode = { id: "run", kind: "routine", label: "Run", routine: "digest", input: set };
    await publish(env, "inputs", p, chain(hook, twoVars(), js({ ...set, path: ["plain"] })));
    for (const leak of [
      js({ ...set, path: ["token"] }),
      agent,
      routine,
      save("keep", { value: set }),
      save("keep", { value: { ...set, path: ["token"] } }),
    ])
      assert.ok((await issuesOf(env, "inputs", chain(hook, twoVars(), leak))).includes("secret_var_text"), leak.kind);
    // The plain variable is fine as an input; code gets the variables without the secret one.
    assert.equal((await post(env, "inputs", "e1", { go: true })).state, "succeeded");
    assert.deepEqual(output(env, "inputs", "e1", "code"), { plain: "p" });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
