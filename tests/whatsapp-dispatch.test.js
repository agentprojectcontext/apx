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
const {
  handleWhatsAppMessage, _resetReportThrottle, _resetOwed, _setRetryDelays, isWhatsAppReplyOwed, followUpWhatsApp,
} = await import("#core/channels/whatsapp/dispatch.js");
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

// No settle delay in the tests: the debounce has its own file, and paying 2.5s
// per case here would buy nothing and cost half a minute.
patchWhatsAppConfig({ owner_jid: OWNER, auto_reply: true, reply_delay_ms: 0 });
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
  whatsapp: { ...readConfig().whatsapp, reply_delay_ms: 0 },
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
  // Flat, like every other channel: the attachment's own fields at the top of
  // meta plus `media_kind`. It used to nest under `meta.media`, where the one
  // function that turns a row back into an attachment could not see it.
  const row = rows.find((r) => r.meta?.media_kind === "reaction");
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

test("two people on one line become two threads, not one shared pile", async () => {
  _resetReportThrottle();
  const h = harness();
  await handleWhatsAppMessage(msg(CARLA, "te dejo esto anotado"), h.ctx);
  await handleWhatsAppMessage(msg(OWNER, "che roby, todo bien?"), h.ctx);

  const { listGlobalThreads, readGlobalThread } = await import("#core/stores/messages.js");
  const threads = listGlobalThreads({ channels: ["whatsapp"] }).filter((t) => t.contact);

  const carla = threads.find((t) => t.title === "Carla");
  const owner = threads.find((t) => t.contact === "owner");
  assert.ok(carla, `Carla has no thread of her own: ${JSON.stringify(threads)}`);
  assert.ok(owner, "the owner's own WhatsApp chat is a thread too");
  assert.notEqual(carla.id, owner.id);

  // The containment the sealed turn provides in the MODEL must also hold in the
  // VIEWER: opening Carla's thread cannot show what the owner wrote.
  const read = readGlobalThread({ channel: "whatsapp", date: carla.id });
  assert.ok(
    read.messages.every((m) => !m.content.includes("che roby")),
    "the owner's message leaked into a contact's thread",
  );
  assert.ok(read.messages.some((m) => m.content.includes("te dejo esto anotado")));
});

test("a turn that takes its time is waited for, not cut into a canned line", async () => {
  _resetReportThrottle();
  const h = harness();
  // 2026-09-23: every fast model was down, the chain reached a local model that
  // needed more than the 90 s a contact's turn was allowed, and the deadline
  // answered twice with the same fixed "ahora no puedo contestarte bien". A
  // chat has no deadline; a hang is cut one level down, per engine call.
  //
  // The old knobs, set tiny: a deadline that still existed would fire here.
  patchWhatsAppConfig({ turn_deadline_ms: 50, third_party_deadline_ms: 50 });
  await handleWhatsAppMessage(msg(CARLA, "[mock:slow:300] me hacés un favor?"), h.ctx);
  assert.equal(h.sent.length, 1);
  assert.doesNotMatch(h.sent[0].text, /no puedo contestarte|te respondo en un rato/i);
  assert.ok(!h.reports.some((r) => r.meta.kind === "whatsapp_error"), "nothing failed, nothing to report");
});

test("when no model answers, nothing canned is sent — the reply is owed and the retry reads the thread", async () => {
  _resetReportThrottle();
  _resetOwed();
  _setRetryDelays([80]);
  const h = harness();
  // Its own config object: the retry reads it again, and by then the model is back.
  h.ctx.globalConfig = { ...globalConfig, super_agent: { ...globalConfig.super_agent, model: "fail-503" } };

  await handleWhatsAppMessage(msg(CARLA, "[mock:system] me pasás el logo?"), h.ctx);
  assert.equal(h.sent.length, 0, "no fixed sentence goes to the contact");
  assert.ok(isWhatsAppReplyOwed(CARLA, CARLA), "the conversation is owed a reply");
  const failed = h.reports.filter((r) => r.meta.kind === "whatsapp_error");
  assert.equal(failed.length, 1, "the owner is told once");
  assert.match(failed[0].text, /Carla/);
  assert.match(failed[0].text, /reintento/, "in the owner's language, saying what happens next");

  h.ctx.globalConfig.super_agent.model = "mock:base";
  for (let i = 0; i < 40 && !h.sent.length; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(h.sent.length, 1, "the retry answered");
  // `[mock:system]` returns the system prompt: the turn was told its reply
  // system failed, and was left to say so in its own words.
  assert.match(h.sent[0].text, /Reply system note/);
  assert.match(h.sent[0].text, /in your own words/);
  assert.ok(!isWhatsAppReplyOwed(CARLA, CARLA), "answered, so no longer owed");
  assert.ok(h.reports.some((r) => r.meta.kind === "whatsapp_relay"), "and the owner hears it was answered");
  _setRetryDelays(null);
});

test("the retries run out quietly: one more notice, and still nothing canned", async () => {
  _resetReportThrottle();
  _resetOwed();
  _setRetryDelays([20]);
  const h = harness();
  h.ctx.globalConfig = { ...globalConfig, super_agent: { ...globalConfig.super_agent, model: "fail-503" } };
  await handleWhatsAppMessage(msg(CARLA, "sigue ahí?"), h.ctx);
  for (let i = 0; i < 40 && h.reports.filter((r) => r.meta.kind === "whatsapp_error").length < 2; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const failed = h.reports.filter((r) => r.meta.kind === "whatsapp_error");
  assert.equal(failed.length, 2, "first failure + giving up, nothing in between");
  assert.match(failed[1].text, /follow-up/);
  assert.equal(h.sent.length, 0);
  assert.ok(isWhatsAppReplyOwed(CARLA, CARLA));
  _resetOwed();
  _setRetryDelays(null);
});

test("follow-up picks a conversation up by name and answers from the thread", async () => {
  _resetReportThrottle();
  _resetOwed();
  const h = harness();
  await handleWhatsAppMessage(msg(CARLA, "[mock:system] y el logo?"), h.ctx);
  const before = h.sent.length;

  const plan = await followUpWhatsApp("carla", h.ctx);
  assert.equal(plan.name, "Carla");
  assert.equal(plan.chat_jid, CARLA);
  assert.equal(await plan.run(), true);
  assert.equal(h.sent.length, before + 1);
  assert.match(h.sent.at(-1).text, /Reply system note/, "told why it is picking the thread up");

  await assert.rejects(() => followUpWhatsApp("nadie-con-este-nombre", h.ctx), /no WhatsApp contact|no conversation/);
});

test("a status story is dropped before anything logs or answers", async () => {
  _resetReportThrottle();
  const h = harness();
  const { GLOBAL_MESSAGES_DIR: DIR } = await import("#core/config/index.js");
  const day = `${new Date().toISOString().slice(0, 10)}.jsonl`;
  const file = path.join(DIR, "whatsapp", day);
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8").length : 0;

  // Someone's story, addressed to the status feed with the person as participant.
  await handleWhatsAppMessage({
    key: { remoteJid: "status@broadcast", participant: CARLA, id: "st-1", fromMe: false },
    message: { conversation: "mirá mis vacaciones" },
    pushName: "Carla",
  }, h.ctx);

  const after = fs.existsSync(file) ? fs.readFileSync(file, "utf8").length : 0;
  assert.equal(after, before, "a story must not reach the ledger");
  assert.equal(h.sent.length, 0, "and must not be answered");
  assert.equal(h.reports.length, 0, "and must not become a Telegram");
});

test("a bot's button menu is not an empty message", async () => {
  _resetReportThrottle();
  const h = harness();
  const BOT = "104900000000000@lid";
  await handleWhatsAppMessage(
    {
      key: { remoteJid: BOT, id: "menu-1", fromMe: false },
      // Business accounts ship interactive messages inside viewOnce, and the
      // labels live in a JSON string inside each button. Reading the top level
      // only — which is all `textOf` used to do — sees no text anywhere.
      message: {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              body: { text: "Hola! Con qué te ayudo?" },
              nativeFlowMessage: {
                buttons: [
                  { name: "quick_reply", buttonParamsJson: '{"display_text":"Autos","id":"auto"}' },
                  { name: "quick_reply", buttonParamsJson: '{"display_text":"Hogar","id":"hogar"}' },
                ],
              },
            },
          },
        },
      },
      pushName: "Northwind Seguros",
    },
    h.ctx
  );

  const day = new Date().toISOString().slice(0, 10);
  const rows = fs.readFileSync(path.join(GLOBAL_MESSAGES_DIR, "whatsapp", `${day}.jsonl`), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const row = rows.filter((r) => r.meta?.sender_jid === BOT).pop();

  assert.ok(row, "the menu is on the ledger");
  assert.notEqual(row.body, "[empty message]", "this is the bug: a whole menu read as nothing");
  assert.match(row.body, /Con qué te ayudo\?/);
  assert.match(row.body, /\[Opciones: 1\. Autos \| 2\. Hogar\]/);

  // The options are kept as data too, so the menu can be answered later by a
  // turn that never saw the proto.
  assert.equal(row.meta.interactive_kind, "interactive");
  assert.deepEqual(row.meta.interactive_options.map((o) => o.title), ["Autos", "Hogar"]);

  // And the owner is told what the choices ARE — a report saying a bot sent an
  // empty message is the symptom this whole path exists to remove.
  assert.equal(h.reports.length, 1);
  assert.match(h.reports[0].text, /1\. Autos \| 2\. Hogar/);
});

test("the button a contact tapped reads as the choice it was", async () => {
  _resetReportThrottle();
  const h = harness();
  await handleWhatsAppMessage(
    {
      key: { remoteJid: CARLA, id: "tap-1", fromMe: false },
      message: { buttonsResponseMessage: { selectedButtonId: "si", selectedDisplayText: "Sí, confirmo" } },
      pushName: "Carla",
    },
    h.ctx
  );
  const day = new Date().toISOString().slice(0, 10);
  const rows = fs.readFileSync(path.join(GLOBAL_MESSAGES_DIR, "whatsapp", `${day}.jsonl`), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const row = rows.filter((r) => r.meta?.sender_jid === CARLA && r.direction === "in").pop();
  assert.equal(row.body, "[eligió: Sí, confirmo]");
  assert.equal(row.meta.interactive_selection.id, "si");
  assert.ok(!row.meta.interactive_options, "a tap offers nothing to tap back");
  // Unlike a reaction, a choice IS something said — it gets an answer.
  assert.equal(h.sent.length, 1);
});
