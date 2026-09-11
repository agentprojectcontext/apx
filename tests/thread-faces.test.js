// A multi-agent thread wears the same faces and the same name on EVERY surface.
//
// The bug this pins: `/inbox?channel=a2a&thread=andy~opencode` drew both
// agents and titled the thread "Andy · OpenCode", while `/p/0/chat` — the same
// thread, opened from the project Chats tab — drew no faces at all and titled it
// with the raw pair id. Not two bugs: one answer computed in two places. The
// inbox route resolved participants into faces; the thread routes the Chats tab
// reads did not, so the panel had to re-derive them from its own agent list —
// which knows neither the super-agent nor a coding CLI.
//
// Now `api/thread-faces.js` answers it once and both routes ship the answer.
// These tests fail against the old code at the `super-agent/threads` assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-thread-faces-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { createFaceResolver, withContactIdentity } = await import("#host/daemon/api/thread-faces.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

/** An agent with a display name and an avatar — what a face is made of. */
function writeAgent(root, slug, { name, emoji = null, icon = null }) {
  const fm = ["---", `name: ${name}`];
  if (emoji) fm.push(`emoji: ${emoji}`);
  if (icon) fm.push(`icon: ${icon}`);
  fm.push("---", "");
  fs.writeFileSync(path.join(root, ".apc", "agents", `${slug}.md`), `${fm.join("\n")}\n`);
}

/** A project agent and a coding CLI talking to each other, on the ledger. */
function writeA2AThread(storagePath, pair) {
  const dir = path.join(storagePath, "messages");
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    { ts: "2026-08-25T10:00:00Z", channel: "a2a", direction: "in", type: "agent",
      author: pair[0], agent_slug: pair[0], body: "Elegí un número.",
      meta: { from: pair[0], to: pair[1] } },
    { ts: "2026-08-25T10:00:30Z", channel: "a2a", direction: "out", type: "agent",
      author: pair[1], agent_slug: pair[1], body: "El 42.",
      meta: { from: pair[1], to: pair[0] } },
  ];
  fs.appendFileSync(
    path.join(dir, "2026-08-25.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
}

/** A Telegram day — an ordinary thread, nobody's pair. */
function writeTelegramDay(homeDir) {
  const dir = path.join(homeDir, ".apx", "messages", "telegram");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "2026-08-25.jsonl"),
    JSON.stringify({
      ts: "2026-08-25T09:00:00Z", channel: "telegram", direction: "in",
      type: "user", author: "owner", body: "buenas",
    }) + "\n"
  );
}

function api(projects) {
  return buildApi({
    projects, registries: null, plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
}

async function withProject(fn, { pair = ["andy", "opencode"] } = {}) {
  const root = makeTempProject({ name: "Faces Project" });
  writeAgent(root, "andy", { name: "Andy", emoji: "🤖" });
  const projects = new ProjectManager({});
  projects.register(root);
  const id = projects.list()[0].id;
  writeA2AThread(projects.get(id).storagePath, pair);
  const { server, baseUrl } = await listen(api(projects));
  try {
    await fn({ baseUrl, id, root, projects });
  } finally {
    server.close();
    cleanupTempProject(root);
  }
}

const a2aOf = (threads) => threads.find((t) => t.channel === "a2a");

test("the Chats sidebar gets faces and real names, not a raw pair id", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads`);
    assert.equal(res.status, 200);
    const th = a2aOf(await res.json());
    assert.ok(th, "the a2a thread is listed");
    // Used to be "andy · opencode" with no faces at all — which is what the
    // project chat header then printed as `andy~opencode`.
    assert.equal(th.title, "Andy · OpenCode");
    assert.deepEqual(th.participants, ["andy", "opencode"]);
    assert.equal(th.participant_faces.length, 2);
    assert.deepEqual(th.participant_faces[0], { slug: "andy", name: "Andy", emoji: "🤖", icon: null });
    // A coding CLI is not a project agent — no file resolves it — but it still
    // reads as its brand, which is what makes its logo land.
    assert.deepEqual(th.participant_faces[1], { slug: "opencode", name: "OpenCode", emoji: null, icon: null });
  });
});

test("opening the thread carries the same faces as listing it", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads/a2a/andy~opencode`);
    assert.equal(res.status, 200);
    const th = await res.json();
    // This is the payload the chat header reads (useChat.loadThread). Without
    // it the header had only the thread id and drew nothing.
    assert.equal(th.title, "Andy · OpenCode");
    assert.deepEqual(th.participant_faces.map((f) => f.name), ["Andy", "OpenCode"]);
    assert.ok(th.messages.length >= 2, "the messages still come with it");
  });
});

test("the inbox and the thread routes give the same answer — that is the point", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const [inbox, threads, detail] = await Promise.all([
      fetch(`${baseUrl}/api/inbox`).then((r) => r.json()),
      fetch(`${baseUrl}/api/projects/${id}/super-agent/threads`).then((r) => r.json()),
      fetch(`${baseUrl}/api/projects/${id}/super-agent/threads/a2a/andy~opencode`).then((r) => r.json()),
    ]);
    const row = (inbox.data || []).find((r) => r.kind === "a2a");
    const listed = a2aOf(threads);
    assert.equal(row.agent_name, listed.title);
    assert.equal(row.agent_name, detail.title);
    assert.deepEqual(row.participant_faces, listed.participant_faces);
    assert.deepEqual(row.participant_faces, detail.participant_faces);
  });
});

test("the super-agent in a pair wears its persona and its blob, not `super_agent`", async () => {
  fs.mkdirSync(path.join(TMP_HOME, ".apx"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_HOME, ".apx", "identity.json"),
    JSON.stringify({ agent_name: "Nova" }),
  );
  await withProject(async ({ baseUrl, id }) => {
    const th = a2aOf(await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads`).then((r) => r.json()));
    assert.equal(th.title, "Andy · Nova");
    assert.deepEqual(th.participant_faces[1], {
      slug: "super_agent", name: "Nova", emoji: null, icon: "noche",
    });
  }, { pair: ["andy", "super_agent"] });
  fs.rmSync(path.join(TMP_HOME, ".apx", "identity.json"), { force: true });
});

test("legacy roby and roby-orchestrator rows keep recognizable avatars", async () => {
  await withProject(async ({ root }) => {
    writeAgent(root, "roby-orchestrator", { name: "Roby Orchestrator", icon: "orbit" });
    const resolver = createFaceResolver([root]);
    const legacy = resolver.face("roby");
    const orchestrator = resolver.face("roby-orchestrator");
    assert.equal(legacy.icon, "noche");
    assert.equal(legacy.slug, "super_agent");
    assert.equal(orchestrator.icon, "orbit");
    assert.equal(orchestrator.name, "Roby Orchestrator");
  }, { pair: ["andy", "roby"] });
});

test("a group keeps the name someone gave it, and gets one when nobody did", async () => {
  const root = makeTempProject({ name: "Group Project" });
  writeAgent(root, "andy", { name: "Andy", emoji: "🤖" });
  writeAgent(root, "magui", { name: "Magui", icon: "orbit" });
  const projects = new ProjectManager({});
  projects.register(root);
  const id = projects.list()[0].id;
  const { server, baseUrl } = await listen(api(projects));
  try {
    const create = async (body) =>
      (await fetch(`${baseUrl}/api/projects/${id}/groups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })).json();

    const unnamed = await create({ participants: ["andy", "magui"] });
    const named = await create({ title: "Sprint review", participants: ["andy", "magui"] });

    const threads = await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads`).then((r) => r.json());
    const byId = (gid) => threads.find((t) => t.id === gid);
    assert.equal(byId(unnamed.id).title, "Andy · Magui", "no name of its own → its members");
    assert.equal(byId(named.id).title, "Sprint review", "a real name is never overwritten");
    assert.deepEqual(byId(named.id).participant_faces[1], {
      slug: "magui", name: "Magui", emoji: null, icon: "orbit",
    });
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("an ordinary channel thread is left exactly as it was", async () => {
  writeTelegramDay(TMP_HOME);
  await withProject(async ({ baseUrl, id }) => {
    const threads = await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads`).then((r) => r.json());
    const tg = threads.find((t) => t.channel === "telegram");
    if (!tg) return; // the global ledger is shared across the suite; absence is fine
    assert.equal(tg.participant_faces, undefined, "a Telegram day has no participants to draw");
    assert.equal(tg.title, "buenas", "its title is still the first thing said");
  });
});

// ── One human, several addresses ───────────────────────────────────────────
// A thread's `contact` is the address a message arrived FROM; a person has more
// than one. Every roster row carries `alts` and both spellings are live at
// once, so the same contact can own two threads on the same day under two keys.
//
// The ledger is right to record each as it arrived — it says what was true then
// — so it is the READER that has to decide they are one conversation. Without a
// resolved key on the thread, a surface can only compare the raw ones: the
// session switcher scoped that way shows part of a person's history while
// looking complete, which is worse than showing none of it.

const ROSTER = {
  whatsapp: {
    owner_jid: "100000000000001@lid",
    owner_alts: ["5550000000001@example.net"],
    contacts: [
      { jid: "100000000000001@lid", alts: ["5550000000001@example.net"], name: "The owner" },
      { jid: "100000000000002@lid", alts: ["5550000000002@example.net"], name: "Ana Rivas" },
    ],
  },
};

const waThread = (contact, over = {}) => ({
  id: `2026-09-10~${contact}`,
  channel: "whatsapp",
  contact,
  title: contact,
  ...over,
});

test("both of one person's addresses resolve to the same contact_person", () => {
  const byJid = withContactIdentity(waThread("100000000000002@lid"), ROSTER);
  const byAlt = withContactIdentity(waThread("5550000000002@example.net"), ROSTER);
  assert.equal(byJid.contact_person, "100000000000002@lid");
  assert.equal(byAlt.contact_person, "100000000000002@lid", "her other line is still her");
  // And the roster still names both, which is what the field was added beside.
  assert.equal(byJid.title, "Ana Rivas");
  assert.equal(byAlt.title, "Ana Rivas");
});

test("the owner is one key whichever line they wrote from", () => {
  for (const contact of ["owner", "100000000000001@lid", "5550000000001@example.net"]) {
    assert.equal(withContactIdentity(waThread(contact), ROSTER).contact_person, "owner", contact);
  }
});

test("a stranger is their own person, not everyone's", () => {
  // Nobody in the roster, so there is no face to draw — and the thread must
  // still say who it belongs to, or a switcher scoped to it falls back to
  // listing the whole channel.
  const out = withContactIdentity(waThread("5559999999999@example.net"), ROSTER);
  assert.equal(out.contact_person, "5559999999999@example.net");
  assert.equal(out.contact_face, undefined, "no roster row, no picture, no invented name");
  assert.equal(out.title, "5559999999999@example.net", "the store's own title is left alone");
});

test("a thread that belongs to nobody is returned exactly as it was", () => {
  // A Telegram day is the whole day. Stamping a person on it would scope its
  // switcher to a contact that does not exist and empty the menu.
  const day = { id: "2026-09-10", channel: "telegram", title: "buenas" };
  assert.deepEqual(withContactIdentity(day, ROSTER), day);
});
