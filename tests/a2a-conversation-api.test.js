// A2A threads must be readable through the surface the inbox points at.
//
// api/inbox.js lists a2a "group chats" under a SYNTHETIC agent slug,
// `a2a:<pairId>` — a pair exchange belongs to no single agent, so it has no
// agents/<slug>/conversations/ directory. The web opens an inbox row through
// the per-agent conversation endpoints, so every a2a row dead-ended on:
//
//   GET /api/projects/1/agents/a2a:cursor~roby/conversations → 404 agent not found
//
// Not a URL-parsing problem: the ":" reaches the handler intact, encoded or
// not — these tests pin that too, so the theory is not re-litigated.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-api-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

/** Two agents talking to each other, written into the project ledger. */
function writeA2AThread(storagePath, pair = ["cursor", "roby"]) {
  const dir = path.join(storagePath, "messages");
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    { ts: "2026-08-25T10:00:00Z", channel: "a2a", direction: "out", type: "agent",
      author: pair[0], agent_slug: pair[0], body: "Roby, terminé el refactor.",
      meta: { from: pair[0], to: pair[1] } },
    { ts: "2026-08-25T10:00:30Z", channel: "a2a", direction: "in", type: "agent",
      author: pair[1], agent_slug: pair[1], body: "Gracias, lo reviso.",
      meta: { from: pair[1], to: pair[0] } },
  ];
  fs.writeFileSync(
    path.join(dir, "2026-08-25.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
}

function api(projects) {
  return buildApi({
    projects, registries: null, plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
}

async function withProject(fn, pair) {
  const root = makeTempProject({ name: "A2A Project", agents: [{ slug: "roby", role: "super" }] });
  const projects = new ProjectManager({});
  projects.register(root);
  const id = projects.list()[0].id;
  // The a2a ledger lives in the project's STORAGE dir (~/.apx/projects/<id>),
  // which the manager resolves — not in the repo checkout.
  writeA2AThread(projects.get(id).storagePath, pair);
  const { server, baseUrl } = await listen(api(projects));
  try {
    await fn({ baseUrl, id });
  } finally {
    server.close();
    cleanupTempProject(root);
  }
}

test("an a2a thread lists through its synthetic agent slug", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations`);
    assert.equal(res.status, 200, "used to be 404 'agent not found'");
    const list = await res.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "cursor~roby");
    assert.equal(list[0].channel, "a2a");
    assert.equal(list[0].messages, 2);
  });
});

test("the ':' in the slug survives, encoded or raw — it was never the bug", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const raw = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations`);
    const enc = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a%3Acursor~roby/conversations`);
    assert.equal(raw.status, 200);
    assert.equal(enc.status, 200);
    assert.deepEqual(await raw.json(), await enc.json());
  });
});

test("the thread body is readable, with every utterance attributed", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations/cursor~roby`);
    assert.equal(res.status, 200);
    const conv = await res.json();
    assert.equal(conv.channel, "a2a");
    assert.equal(conv.messages.length, 2);
    assert.deepEqual(conv.meta.participants, ["cursor", "roby"]);
    // Each bubble keeps its speaker, which is the whole point of a pair view.
    assert.ok(conv.messages.some((m) => JSON.stringify(m).includes("cursor")));
    assert.ok(conv.messages.some((m) => JSON.stringify(m).includes("roby")));
  });
});

test("an unknown a2a pair is 'conversation not found', not 'agent not found'", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:nadie~nada/conversations/nadie~nada`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "conversation not found");
  });
});

test("renaming an a2a thread says why it cannot, instead of blaming the agent", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations/cursor~roby`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "nuevo" }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /a2a threads cannot be renamed/i);
  });
});

test("an ordinary agent slug is unaffected", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const ok = await fetch(`${baseUrl}/api/projects/${id}/agents/roby/conversations`);
    assert.equal(ok.status, 200);
    const missing = await fetch(`${baseUrl}/api/projects/${id}/agents/fantasma/conversations`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, "agent not found");
  });
});

// ── Writes: refuse coherently, on every surface ────────────────────────────
// web, /mobile and the inbox are the same SPA over the same endpoints, so a
// slug the read paths accept must not fall through to "agent not found" (or,
// worse, to running an agent that does not exist) on the write paths.

test("writes aimed at an a2a thread are refused with a reason, not 'agent not found'", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const base = `${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby`;
    const cases = [
      ["POST", `${base}/conversations/cursor~roby/compact`, {}],
      ["POST", `${base}/compact`, {}],
      ["POST", `${base}/chat`, { prompt: "hola" }],
      ["POST", `${base}/exec`, { prompt: "hola" }],
    ];
    for (const [method, url, body] of cases) {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(res.status, 400, `${method} ${url} should be a clear 400`);
      const err = (await res.json()).error;
      assert.match(err, /a2a threads cannot be/i, `${method} ${url}: ${err}`);
      assert.doesNotMatch(err, /agent not found/i);
    }
  });
});

test("the a2a prefix has one definition, shared by the route that mints it", async () => {
  const { A2A_SLUG_PREFIX, a2aSlugThreadId } = await import("#host/daemon/api/shared.js");
  assert.equal(A2A_SLUG_PREFIX, "a2a:");
  assert.equal(a2aSlugThreadId("a2a:cursor~roby"), "cursor~roby");
  assert.equal(a2aSlugThreadId("roby"), null);
  assert.equal(a2aSlugThreadId(undefined), null);
  const inbox = fs.readFileSync(path.join(process.cwd(), "src/host/daemon/api/inbox.js"), "utf8");
  assert.match(inbox, /A2A_SLUG_PREFIX/, "inbox mints the slug from the shared constant");
  assert.doesNotMatch(inbox, /`a2a:\$\{/, "no second hardcoded copy of the prefix");
});

// ── Deleting a pair thread ─────────────────────────────────────────────────
// The one write that DOES mean something for a derived thread. It used to have
// no path at all: the per-agent route refused it, and the thread route fell
// through to `deleteGlobalThread`, which hunts for a channel+day file named
// after the pair id and never finds one — 404 on both surfaces, so an a2a chat
// could be read but never removed.

test("deleting an a2a thread removes its ledger rows, and it stops listing", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const del = await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads/a2a/cursor~roby`, {
      method: "DELETE",
    });
    assert.equal(del.status, 200, "used to be 404 'thread not found'");
    assert.deepEqual(await del.json(), { ok: true, removed: 2 });

    const gone = await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads/a2a/cursor~roby`);
    assert.equal(gone.status, 404);
    const threads = await (await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads`)).json();
    assert.equal(threads.filter((t) => t.id === "cursor~roby").length, 0);
  });
});

test("the same delete works through the synthetic agent slug the inbox opens", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const del = await fetch(
      `${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations/cursor~roby`,
      { method: "DELETE" },
    );
    assert.equal(del.status, 200, "used to refuse with 'a2a threads cannot be deleted'");
    assert.deepEqual(await del.json(), { ok: true, removed: 2 });
    const list = await (await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations`)).json();
    assert.deepEqual(list, []);
  });
});

test("deleting a pair that is not there is a 404, not a silent ok", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const thread = await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads/a2a/nadie~nada`, {
      method: "DELETE",
    });
    assert.equal(thread.status, 404);
    const slug = await fetch(
      `${baseUrl}/api/projects/${id}/agents/a2a:nadie~nada/conversations/nadie~nada`,
      { method: "DELETE" },
    );
    assert.equal(slug.status, 404);
    // …and the thread that IS there is untouched by either miss.
    const kept = await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads/a2a/cursor~roby`);
    assert.equal(kept.status, 200);
  });
});

test("one pair leaves, the other stays — including on a shared day file", async () => {
  const { deleteA2AThread, listProjectA2AThreads } = await import("#core/stores/messages.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-del-"));
  const dir = path.join(root, "messages");
  fs.mkdirSync(dir, { recursive: true });
  const row = (ts, from, to, body) => JSON.stringify({
    ts, channel: "a2a", direction: "out", type: "agent",
    author: from, agent_slug: from, body, meta: { from, to },
  });
  // Two pairs on the same day, plus a third day file holding only the survivor,
  // plus a row on another channel that must not be touched.
  fs.writeFileSync(path.join(dir, "2026-08-25.jsonl"), [
    row("2026-08-25T10:00:00Z", "cursor", "roby", "uno"),
    row("2026-08-25T10:01:00Z", "aider", "roby", "dos"),
    JSON.stringify({ ts: "2026-08-25T10:02:00Z", channel: "web", direction: "in", type: "user",
      author: "manu", body: "hola", meta: {} }),
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "2026-08-26.jsonl"), row("2026-08-26T09:00:00Z", "aider", "roby", "tres") + "\n");

  const out = deleteA2AThread(root, "cursor~roby");
  assert.deepEqual(out, { removed: 1 });
  const left = listProjectA2AThreads(root);
  assert.deepEqual(left.map((t) => t.id), ["aider~roby"]);
  assert.equal(left[0].messages, 2, "the other pair keeps both of its days");
  const day = fs.readFileSync(path.join(dir, "2026-08-25.jsonl"), "utf8");
  assert.match(day, /"channel":"web"/, "an unrelated channel is not collateral");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a pair id carrying a '#' survives the round trip, encoded", async () => {
  // A coding CLI names itself: `opencode#bg`, so the pair id is
  // `opencode#bg~tester`. Raw in a URL the '#' opens the FRAGMENT and the id is
  // truncated to `opencode` before the request even leaves the browser — that
  // is the 404 those chats answered. Encoded, it reaches the route intact.
  await withProject(async ({ baseUrl, id }) => {
    const base = `${baseUrl}/api/projects/${id}/super-agent/threads/a2a`;
    const truncated = await fetch(`${base}/opencode`);
    assert.equal(truncated.status, 404, "what the raw '#' left of the id");

    const ok = await fetch(`${base}/opencode%23bg~tester`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).id, "opencode#bg~tester");

    const del = await fetch(`${base}/opencode%23bg~tester`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { ok: true, removed: 2 });
  }, ["opencode#bg", "tester"]);
});

test("the web client encodes every path segment it does not mint itself", async () => {
  // The guard on the fix above: an id or slug interpolated raw into a path is
  // how the '#' escaped in the first place.
  const client = fs.readFileSync(
    path.join(process.cwd(), "src/interfaces/web/src/lib/api/conversations.ts"), "utf8",
  );
  const segments = [...client.matchAll(/(?<=\/)\$\{([^}]+)\}/g)].map((m) => m[1]);
  assert.ok(segments.length >= 8, "found the interpolated segments at all");
  for (const expr of segments) {
    assert.ok(
      expr === "pid" || expr.startsWith("seg("),
      `path segment \${${expr}} is not encoded`,
    );
  }
});
