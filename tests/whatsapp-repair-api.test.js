// The chat you open says WHO it is with, and the repair is reachable.
//
// Two bugs, one root: a WhatsApp thread is titled by the ledger store, which
// knows only what the rows say. Rows we SENT carry no author — we are not the
// person — so a conversation APX opened, or one whose contact has not written
// since, had nothing to be named after and fell back to the raw address. The
// owner was reading a thread headed "5491155550001@s.whatsapp.net" for somebody
// sitting two rows away in the same sidebar under a name and a photo.
//
// The store cannot fix it (it must not import a channel's identity module), so
// the roster lookup happens at the adapter — and these tests pin that BOTH
// routes, list and open, ship the same answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-repair-api-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const CONTACT = "5491155550001@s.whatsapp.net";
const DAY = "2026-08-25";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

/** A chat where only WE have spoken: no inbound row, so no author anywhere. */
function writeWhatsAppDay(rows) {
  const dir = path.join(process.env.APX_HOME, "messages", "whatsapp");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${DAY}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** A stand-in for the daemon plugin: the routes are adapters over this. */
function fakePlugin(calls) {
  return {
    inspect: () => ({ contacts: [{ kind: "nameless", jid: CONTACT, detail: "x" }], messages: [] }),
    repair: async (opts) => { calls.push(["repair", opts]); return { dry_run: !!opts.dryRun, connected: false, checked: {}, fixed: [], left: [] }; },
    chooseOption: async (jid, option, opts) => { calls.push(["choose", jid, option, opts]); return { id: "MSGX" }; },
  };
}

function api(projects, plugin) {
  return buildApi({
    projects, registries: null,
    plugins: { get: (id) => (id === "whatsapp" ? plugin : null), status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
}

async function withApi(fn, { plugin = null } = {}) {
  const root = makeTempProject({ name: "WA Project" });
  const projects = new ProjectManager({});
  projects.register(root);
  // The DEFAULT workspace, id 0, is where WhatsApp lives: the channel has no
  // project of its own, so its rows are unstamped and belong to project 0 —
  // exactly the scoping the threads route applies. Reading them from the
  // registered project would list nothing, and prove nothing.
  projects.registerDefault();
  const id = 0;
  const calls = [];
  const { server, baseUrl } = await listen(api(projects, plugin || fakePlugin(calls)));
  try {
    await fn({ baseUrl, id, calls });
  } finally {
    server.close();
    cleanupTempProject(root);
  }
}

test("a thread with only our own messages is titled by the person, not their address", async () => {
  const cfg = readConfig();
  cfg.whatsapp = {
    owner_jid: "5491155559999@s.whatsapp.net",
    contacts: [{ jid: CONTACT, name: "Northwind Sam", nickname: "Sam", role: "contact", auto_reply: true }],
  };
  writeConfig(cfg);
  writeWhatsAppDay([
    { ts: `${DAY}T10:00:00Z`, channel: "whatsapp", direction: "out", type: "agent",
      author: null, body: "Hola Sam, te paso el acceso.",
      meta: { chat_jid: CONTACT, sender_jid: CONTACT, contact_key: CONTACT } },
  ]);

  await withApi(async ({ baseUrl, id }) => {
    const listed = (await (await fetch(`${baseUrl}/api/projects/${id}/super-agent/threads`)).json())
      .find((t) => t.channel === "whatsapp");
    assert.ok(listed, "the whatsapp thread is listed");
    // Was the raw jid. The nickname wins because that is what the roster shows
    // everywhere else.
    assert.equal(listed.title, "Sam");
    assert.equal(listed.contact_face.name, "Sam");

    // Opening it directly — a deep link, the phone — gives the same name.
    const opened = await (await fetch(
      `${baseUrl}/api/projects/${id}/super-agent/threads/whatsapp/${encodeURIComponent(`${DAY}~${CONTACT}`)}`,
    )).json();
    assert.equal(opened.title, "Sam");
    assert.equal(opened.messages.length, 1);
  });
});

test("a menu reaches the panel as options, not only as a line of text", async () => {
  const cfg = readConfig();
  cfg.whatsapp = { owner_jid: "5491155559999@s.whatsapp.net", contacts: [{ jid: CONTACT, name: "Sam", role: "contact" }] };
  writeConfig(cfg);
  writeWhatsAppDay([
    { ts: `${DAY}T11:00:00Z`, channel: "whatsapp", direction: "in", type: "user",
      author: "Sam", body: "¿Con qué te ayudo?\n[Opciones: 1. Autos | 2. Hogar]",
      meta: {
        chat_jid: CONTACT, sender_jid: CONTACT, contact_key: CONTACT, external_id: "MSG1",
        interactive_kind: "buttons",
        interactive_options: [{ n: 1, id: "a", title: "Autos" }, { n: 2, id: "b", title: "Hogar" }],
      } },
  ]);

  await withApi(async ({ baseUrl, id }) => {
    const opened = await (await fetch(
      `${baseUrl}/api/projects/${id}/super-agent/threads/whatsapp/${encodeURIComponent(`${DAY}~${CONTACT}`)}`,
    )).json();
    const msg = opened.messages[0];
    assert.equal(msg.interactive.options.length, 2);
    assert.equal(msg.interactive.kind, "buttons");
    // Where a tap has to be sent. Without it the buttons draw and do nothing.
    assert.equal(msg.interactive.chat, CONTACT);
  });
});

test("the repair is reachable, and asking about it changes nothing", async () => {
  await withApi(async ({ baseUrl, calls }) => {
    const found = await (await fetch(`${baseUrl}/api/whatsapp/repair`)).json();
    assert.equal(found.contacts.length, 1);
    assert.equal(calls.length, 0, "GET is a question, not a repair");

    const ran = await (await fetch(`${baseUrl}/api/whatsapp/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dry_run: true }),
    })).json();
    assert.equal(ran.dry_run, true);
    assert.deepEqual(calls[0], ["repair", { dryRun: true, force: false }]);
  });
});

test("tapping an option sends it through the one path that knows the menu", async () => {
  await withApi(async ({ baseUrl, calls }) => {
    const res = await fetch(`${baseUrl}/api/whatsapp/choose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jid: CONTACT, option: 2 }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).message_id, "MSGX");
    assert.deepEqual(calls[0], ["choose", CONTACT, 2, { asText: false }]);

    // A tap with nothing to tap is a 400, not a message sent into the void.
    const bad = await fetch(`${baseUrl}/api/whatsapp/choose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jid: CONTACT }),
    });
    assert.equal(bad.status, 400);
  });
});

test("no whatsapp plugin means 503, never a crash", async () => {
  const root = makeTempProject({ name: "No WA" });
  const projects = new ProjectManager({});
  projects.register(root);
  const { server, baseUrl } = await listen(api(projects, null));
  try {
    assert.equal((await fetch(`${baseUrl}/api/whatsapp/repair`)).status, 503);
    const res = await fetch(`${baseUrl}/api/whatsapp/choose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jid: CONTACT, option: 1 }),
    });
    assert.equal(res.status, 503);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});
