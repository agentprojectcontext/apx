// Inbound WhatsApp, end to end: who gets answered, what the answering turn was
// told, and how often the owner is bothered.
//
// The session is faked (no socket) but the turn is real — it runs through
// runSuperAgent against the mock engine. `[mock:system]` in the inbound body
// makes the reply BE the system prompt, so what the agent got told comes back
// through the same channel the contact would have read. That is what lets this
// file assert containment on the live path rather than on a builder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-disp-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { handleWhatsAppMessage, _resetReportThrottle } = await import("#core/channels/whatsapp/dispatch.js");
const { upsertWhatsAppContact, patchWhatsAppConfig } = await import("#core/channels/whatsapp/config.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { GLOBAL_MESSAGES_DIR } = await import("#core/config/index.js");
const { readConfig } = await import("#core/config/index.js");
const { makeTempProject } = await import("./_helpers.js");

const OWNER = "5491155555555@s.whatsapp.net";
const CARLA = "5491166666666@s.whatsapp.net";
const STRANGER = "5491199999999@s.whatsapp.net";

const PROJECT_SECRET = "ZZPROJECTZZ-estudio-contable";
const TELEGRAM_SECRET = "ZZTELEGRAMZZ el lunes cobramos los 40 palos";

patchWhatsAppConfig({ owner_jid: OWNER, auto_reply: true });
upsertWhatsAppContact(CARLA, { name: "Carla", role: "contact" });

// Something recent on ANOTHER channel — the block that must never cross over.
{
  const dir = path.join(GLOBAL_MESSAGES_DIR, "telegram");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date(Date.now() - 8 * 60_000).toISOString();
  fs.writeFileSync(
    path.join(dir, `${ts.slice(0, 10)}.jsonl`),
    JSON.stringify({ ts, channel: "telegram", direction: "in", type: "user", body: TELEGRAM_SECRET }) + "\n"
  );
}

const projects = new ProjectManager({ engines: {} });
projects.register(makeTempProject({ name: PROJECT_SECRET }));

const globalConfig = {
  ...readConfig(),
  user: { language: "es" },
  super_agent: { enabled: true, model: "mock:base", name: "Roby", permission_mode: "total", model_fallback: { enabled: false } },
  engines: {},
  memory: { active_threads: { enabled: true, window_hours: 6, max_lines: 3 } },
};

function harness() {
  const sent = [];
  const reports = [];
  const session = {
    sendText: async (jid, text) => { sent.push({ jid, text }); },
    markRead: async () => {},
    setTyping: async () => {},
    download: async () => { throw new Error("no media in these tests"); },
  };
  return {
    sent, reports, session,
    ctx: {
      session, globalConfig, projects, plugins: null, registries: null,
      log: () => {},
      notifyOwner: async (text, meta) => { reports.push({ text, meta }); },
    },
  };
}

const msg = (from, body, { group = null } = {}) => ({
  key: { remoteJid: group || from, participant: group ? from : undefined, id: `id-${Math.random()}`, fromMe: false },
  message: { conversation: body },
  pushName: from === CARLA ? "Carla" : "Alguien",
});

test("someone off the roster is never answered — and the owner is told once", async () => {
  _resetReportThrottle();
  const h = harness();
  await handleWhatsAppMessage(msg(STRANGER, "hola, sos el de los autos?"), h.ctx);

  assert.equal(h.sent.length, 0, "a stranger must get nothing back");
  assert.equal(h.reports.length, 1);
  assert.match(h.reports[0].text, /no está en tu lista/);
  assert.equal(h.reports[0].meta.kind, "whatsapp_unknown");
});

test("a burst from that same stranger does not become a burst of Telegrams", async () => {
  _resetReportThrottle();
  const h = harness();
  for (let i = 0; i < 8; i++) {
    await handleWhatsAppMessage(msg(STRANGER, `mensaje ${i}`), h.ctx);
  }
  assert.equal(h.sent.length, 0);
  assert.equal(h.reports.length, 1, "eight messages, one report — this is the anti-storm rule");
});

test("a contact IS answered, and the turn that answers is sealed", async () => {
  _resetReportThrottle();
  const h = harness();
  await handleWhatsAppMessage(msg(CARLA, "[mock:system] hola! cómo va?"), h.ctx);

  assert.equal(h.sent.length, 1, "a contact must never be left on read");
  const systemPrompt = h.sent[0].text;

  // What came back IS the system prompt the model was handed. None of this may
  // be in it.
  assert.ok(!systemPrompt.includes(TELEGRAM_SECRET), `LEAKED the Telegram thread:\n${systemPrompt}`);
  assert.ok(!systemPrompt.includes(PROJECT_SECRET), "LEAKED the project index");
  assert.ok(!/Registered projects/.test(systemPrompt), "LEAKED the project index header");
  assert.ok(!/discover_tools/.test(systemPrompt), "LEAKED the tool catalogue");

  // …and it is still the right prompt for the job.
  assert.match(systemPrompt, /never leave anyone in silence/i);
  assert.match(systemPrompt, /Carla/);
});

test("the owner's own turn is the real one, with everything in it", async () => {
  _resetReportThrottle();
  const h = harness();
  await handleWhatsAppMessage(msg(OWNER, "[mock:system] qué tengo hoy?"), h.ctx);

  assert.equal(h.sent.length, 1);
  const systemPrompt = h.sent[0].text;
  assert.ok(systemPrompt.includes(PROJECT_SECRET), "the owner sees their own projects");
  assert.match(systemPrompt, /Channel: \*\*whatsapp\*\*/);
  // The owner was in the conversation; reporting it back to them would be
  // telling them what they just said.
  assert.equal(h.reports.length, 0, "no relay report for the owner's own messages");
});

test("a group is silent even when a known contact writes in it", async () => {
  _resetReportThrottle();
  const h = harness();
  await handleWhatsAppMessage(
    msg(CARLA, "hola gente", { group: "120363000000000000@g.us" }),
    h.ctx
  );
  assert.equal(h.sent.length, 0, "everything said in a group is read by people nobody vouched for");
});

test("every message is logged, answered or not", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(GLOBAL_MESSAGES_DIR, "whatsapp", `${day}.jsonl`);
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const fromStranger = rows.filter((r) => r.meta?.sender_jid === STRANGER);
  assert.ok(fromStranger.length >= 8, "the unanswered ones are on disk too");
  assert.ok(fromStranger.every((r) => r.direction === "in"), "…and none of them got a reply");
  assert.ok(fromStranger.every((r) => r.meta?.policy === "silent"));

  // Per-contact threads: the sender's JID is the actor, which is what makes a
  // conversation readable without a second store.
  assert.ok(rows.some((r) => r.meta?.sender_jid === CARLA && r.direction === "out"));
});

test("a reaction is logged but never answered", async () => {
  _resetReportThrottle();
  const h = harness();
  await handleWhatsAppMessage(
    {
      key: { remoteJid: CARLA, id: "react-1", fromMe: false },
      message: { reactionMessage: { text: "❤️", key: { id: "earlier" } } },
      pushName: "Carla",
    },
    h.ctx
  );
  // Replying to a ❤️ is what a person would never do — and it is also how one
  // tap becomes an LLM call plus a message back.
  assert.equal(h.sent.length, 0, "no reply to a reaction");
  assert.equal(h.reports.length, 0, "and no report either");

  const day = new Date().toISOString().slice(0, 10);
  const rows = fs.readFileSync(path.join(GLOBAL_MESSAGES_DIR, "whatsapp", `${day}.jsonl`), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const row = rows.find((r) => r.meta?.media?.kind === "reaction");
  assert.ok(row, "…but it IS in the thread, or the conversation reads wrong");
  assert.match(row.body, /❤️/);
});

test("a reply records which model answered and what it cost", async () => {
  _resetReportThrottle();
  const h = harness();
  await handleWhatsAppMessage(msg(CARLA, "hola!"), h.ctx);
  assert.equal(h.sent.length, 1);

  const day = new Date().toISOString().slice(0, 10);
  const rows = fs.readFileSync(path.join(GLOBAL_MESSAGES_DIR, "whatsapp", `${day}.jsonl`), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const out = rows.filter((r) => r.direction === "out" && r.meta?.sender_jid === CARLA).pop();

  // Every other channel already stored these, so a WhatsApp reply rendered
  // without the footer its neighbours had — and nothing could price it or tell
  // a sealed turn from the owner's.
  assert.ok(out.meta.model, "the model that answered");
  assert.ok(out.meta.usage, "and the token usage");
  assert.equal(out.meta.audience, "third_party", "…and that this one was sealed");
});
