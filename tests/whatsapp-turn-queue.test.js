// Writing again while it is still thinking.
//
// The debounce (whatsapp-settle.test.js) covers the 2.5s before a turn starts.
// This file covers the minutes AFTER it starts, which is where the owner's turn
// actually lives: it has tools and a six-minute deadline, and anything typed
// inside those minutes used to open a second turn beside the first. Two model
// calls, neither holding the other's message or the other's reply, both
// answering.
//
// 2026-09-16, the owner's own thread: "desglosalo y mandame el detalle por
// telegram", then the audio with the four points eight seconds behind it. Back
// came "Ya está, desglosé los cuatro puntos" and, thirteen seconds later, "¿Qué
// es lo que querés que desglose? No tengo el contexto inmediato". Each answer
// was true about the turn that wrote it. Together they read as an assistant
// that had lost the thread.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-queue-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { handleWhatsAppMessage, _resetTurnQueue, _resetReportThrottle } =
  await import("#core/channels/whatsapp/dispatch.js");
const { upsertWhatsAppContact, patchWhatsAppConfig } = await import("#core/channels/whatsapp/config.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { readConfig } = await import("#core/config/index.js");
const { makeTempProject } = await import("./_helpers.js");

const OWNER = "5491155555555@s.whatsapp.net";
const CARLA = "5491166666666@s.whatsapp.net";

// The debounce is not what this file is about, and 2.5s a case would buy
// nothing. Deadlines off (0 ⇒ the constant), so a slow mock is not cut.
patchWhatsAppConfig({ owner_jid: OWNER, auto_reply: true, reply_delay_ms: 0, turn_deadline_ms: 0, third_party_deadline_ms: 0 });
upsertWhatsAppContact(CARLA, { name: "Carla", role: "contact" });

const projects = new ProjectManager({ engines: {} });
projects.register(makeTempProject({ name: "Proyecto" }));

const baseConfig = {
  ...readConfig(),
  whatsapp: { ...readConfig().whatsapp, reply_delay_ms: 0 },
  user: { language: "es" },
  super_agent: { enabled: true, model: "mock:base", name: "Roby", permission_mode: "total", model_fallback: { enabled: false } },
  engines: {},
};

function harness(globalConfig = baseConfig) {
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

const msg = (from, body) => ({
  key: { remoteJid: from, id: `id-${Math.random()}`, fromMe: false },
  message: { conversation: body },
  pushName: from === CARLA ? "Carla" : "Manu",
});

/** Long enough for the first turn to be inside the engine, not at its door. */
const settled = () => new Promise((r) => setTimeout(r, 60));

test("a message typed mid-turn is answered after that turn, not beside it", async () => {
  _resetTurnQueue();
  const h = harness();

  // The order is the whole assertion. The second message is FAST and the first
  // is SLOW, so without a queue the second answer overtakes the first and the
  // owner reads the replies in the opposite order to the questions — which is
  // the shape of the 2026-09-16 exchange.
  const first = handleWhatsAppMessage(msg(OWNER, "[mock:slow:300] [mock:reply:UNO] desglosalo"), h.ctx);
  await settled();
  const second = handleWhatsAppMessage(msg(OWNER, "[mock:reply:DOS] los cuatro puntos son estos"), h.ctx);
  await Promise.all([first, second]);

  assert.deepEqual(h.sent.map((s) => s.text), ["UNO", "DOS"], "answered in the order they were asked");
});

test("everything that piled up gets ONE answer, and that answer holds all of it", async () => {
  _resetTurnQueue();
  const h = harness();

  const first = handleWhatsAppMessage(msg(OWNER, "[mock:slow:300] [mock:reply:UNO] arrancá"), h.ctx);
  await settled();
  // Two more while it works. No `[mock:reply:]` on these: the default echo
  // gives back the prompt the turn was handed, which is how we see that ONE
  // turn was handed BOTH of them.
  await handleWhatsAppMessage(msg(OWNER, "ah y aparte esto"), h.ctx);
  await handleWhatsAppMessage(msg(OWNER, "y esto otro tambien"), h.ctx);
  await first;

  assert.equal(h.sent.length, 2, "one answer for the turn, one for everything behind it");
  assert.equal(h.sent[0].text, "UNO");
  assert.match(h.sent[1].text, /ah y aparte esto/);
  assert.match(h.sent[1].text, /y esto otro tambien/);
});

test("the queue is per conversation — one slow turn does not hold up somebody else", async () => {
  _resetTurnQueue();
  _resetReportThrottle();
  const h = harness();

  const slow = handleWhatsAppMessage(msg(CARLA, "[mock:slow:300] [mock:reply:CARLA] hola"), h.ctx);
  await settled();
  await handleWhatsAppMessage(msg(OWNER, "[mock:reply:MANU] che"), h.ctx);
  // The owner's answer is already out while Carla's turn is still running: two
  // people are two conversations, and serialising them behind one another would
  // make every third party a queue in front of the owner.
  assert.deepEqual(h.sent.map((s) => s.text), ["MANU"]);
  await slow;
  assert.deepEqual(h.sent.map((s) => s.text), ["MANU", "CARLA"]);
});

test("a turn that breaks still answers the owner instead of leaving them on read", async () => {
  _resetTurnQueue();
  _resetReportThrottle();
  // `fail-<status>` makes the engine throw rather than hang — the failure the
  // deadline does NOT catch. The owner used to get the empty string here (which
  // sends nothing) while the report went to Telegram, so on WhatsApp it read as
  // the assistant having simply stopped answering.
  const h = harness({
    ...baseConfig,
    super_agent: { ...baseConfig.super_agent, model: "fail-500", model_fallback: { enabled: false } },
  });

  await handleWhatsAppMessage(msg(OWNER, "hacé esto"), h.ctx);

  assert.equal(h.sent.length, 1, "the owner is answered");
  assert.match(h.sent[0].text, /no llegué a contestarte/i);
  assert.ok(
    h.reports.some((r) => r.meta.kind === "whatsapp_error"),
    "and it is reported, not only apologised for",
  );
});
