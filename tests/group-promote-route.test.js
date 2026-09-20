// `POST /projects/:pid/groups` through the door the panel actually knocks on.
//
// The shape that was missing is `from`: the chat being CONVERTED. Without it
// the only thing this route could do was open an empty room beside the
// conversation you were having, which is the bug — see group-promote.test.js
// for the store half and the words that reported it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-promote-route-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { apiRouter } = await import("./_helpers.js");
const { register: registerGroups } = await import("../src/host/daemon/api/groups.js");
const { appendMessageToFs, readProjectGroupThread, a2aThreadId } =
  await import("#core/stores/messages.js");
const { startConversation, appendTurn } = await import("#core/stores/conversations.js");

function makeProject() {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "acme", apx: "installed" }));
  for (const [slug, name] of [["magui", "Magui"], ["andy", "Andy"]]) {
    fs.writeFileSync(
      path.join(root, ".apc", "agents", `${slug}.md`),
      ["---", `Name: ${name}`, "Role: Tester", "Model: mock", "---", "", "A test agent."].join("\n"),
    );
  }
  return {
    id: "1", name: "acme", path: root, storagePath: storage,
    logMessage: (row) => appendMessageToFs({ projectRoot: storage, ...row }),
  };
}

async function serve(PROJECT) {
  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  registerGroups(router, {
    projects: { list: () => [PROJECT], get: () => PROJECT, rebuild: () => {} },
    project: () => PROJECT,
    config: { model: "mock", engines: {} },
    plugins: {},
    registries: null,
  });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const post = (base, pid, body) =>
  fetch(`${base}/api/projects/${pid}/groups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("creating a room from a 1:1 carries the 1:1 into it", async () => {
  const P = makeProject();
  const conv = startConversation({
    storagePath: P.storagePath, agentSlug: "magui", engine: "mock", channel: "web",
  });
  appendTurn({ filePath: conv.path, role: "user", content: "¿Seguimos con el brief?" });
  appendTurn({ filePath: conv.path, role: "assistant", content: "Dale.", meta: { agent: "magui" } });

  const { server, base } = await serve(P);
  try {
    const res = await post(base, P.id, {
      participants: ["magui", "andy"],
      from: { agent: "magui", conversation: conv.id },
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.imported, 2, "the answer says how much was carried");
    assert.deepEqual(body.participants.sort(), ["andy", "magui"]);
    const room = readProjectGroupThread(P.storagePath, body.id);
    assert.deepEqual(room.messages.map((m) => m.content), ["¿Seguimos con el brief?", "Dale."]);
  } finally { server.close(); }
});

test("creating a room from an a2a pair needs no participants at all", async () => {
  // The pair already says who is in it. This is the one create with no
  // `participants`, so it has to be answered before the "at least one agent"
  // guard every other shape passes.
  const P = makeProject();
  P.logMessage({
    agent_slug: "magui", channel: "a2a", direction: "in", author: "andy",
    body: "¿Cómo va acme?", meta: { from: "andy" }, ts: "2026-09-11T10:00:00Z", external_id: "x1",
  });
  P.logMessage({
    agent_slug: "magui", channel: "a2a", direction: "out", type: "agent", actor_kind: "agent",
    actor_id: "magui", author: "magui", body: "Cerrado.", meta: { to: "andy", final: true },
    ts: "2026-09-11T10:01:00Z", external_id: "x2",
  });
  P.logMessage({
    agent_slug: "andy", channel: "a2a", direction: "in", author: "magui",
    body: "Cerrado.", meta: { from: "magui" }, ts: "2026-09-11T10:01:00Z", external_id: "x2",
  });

  const { server, base } = await serve(P);
  try {
    const res = await post(base, P.id, { from: { thread: a2aThreadId("andy", "magui") } });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.deepEqual(body.participants.sort(), ["andy", "magui"]);
    assert.equal(body.imported, 2);
    const room = readProjectGroupThread(P.storagePath, body.id);
    assert.deepEqual(room.messages.map((m) => m.content), ["¿Cómo va acme?", "Cerrado."]);
  } finally { server.close(); }
});

test("a half-written `from` is refused rather than guessed at", async () => {
  const P = makeProject();
  const { server, base } = await serve(P);
  try {
    const res = await post(base, P.id, { participants: ["magui"], from: { agent: "magui" } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /both agent and conversation/);
  } finally { server.close(); }
});

test("promoting a conversation of an agent that does not exist 404s", async () => {
  const P = makeProject();
  const { server, base } = await serve(P);
  try {
    const res = await post(base, P.id, {
      participants: ["magui"],
      from: { agent: "nadie", conversation: "2026-01-01-01" },
    });
    assert.equal(res.status, 404);
  } finally { server.close(); }
});

test("creating a plain room still works exactly as it did", async () => {
  const P = makeProject();
  const { server, base } = await serve(P);
  try {
    const res = await post(base, P.id, { participants: ["magui", "andy"], title: "Acme" });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.title, "Acme");
    assert.equal(body.imported, undefined, "nothing was promoted, so nothing is claimed");
  } finally { server.close(); }
});
