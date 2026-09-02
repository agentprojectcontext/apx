// The never-silent floor on the web.
//
// Telegram has always had one: when a turn's closing comes back empty, the
// model is asked to write it from what the turn did, and a canned i18n line
// goes out only if that fails too. The web had none — `result.text` was passed
// through verbatim, so a dud turn rendered as an empty bubble and was written
// to the thread as an empty assistant row, which is what the NEXT turn reads
// back as the answer this one gave.
//
// runAgent already re-prompts a dud turn twice before giving up, so this is
// rare; rare is not the same as harmless, and the comment where it gives up
// says the surface is supposed to catch it.
//
// What is pinned here: the layering (model first, canned only as a floor), that
// a real answer is never spoken over, and that an INTERRUPTED turn which wrote
// nothing still leaves no bubble at all — flooring that one would answer a
// question the user withdrew.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-web-floor-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { apiRouter, makeTempProject } = await import("./_helpers.js");
const { floorReplyText, closingFloorLine } = await import("#core/agent/closing-floor.js");
const { register: registerSuperAgent } = await import("#host/daemon/api/super-agent.js");
const { register: registerExec } = await import("#host/daemon/api/exec.js");
const { register: registerTurns } = await import("#host/daemon/api/turns.js");
const { readConversation, listConversations } = await import("#core/stores/conversations.js");
const { readGlobalThread } = await import("#core/stores/messages.js");
const { t } = await import("#core/i18n/index.js");

const CONFIG = {
  user: { language: "es" },
  super_agent: { enabled: true, name: "apx", model: "mock:test", permission_mode: "total" },
  engines: {},
};
const TODAY = new Date().toISOString().slice(0, 10);
const DONE = t("reply.fallback_done", { lang: "es" });
const CONTINUE = t("reply.fallback_continue", { lang: "es" });

// ── the floor itself ────────────────────────────────────────────────────────

test("floor: a turn that answered is never spoken over, and costs nothing", async () => {
  const out = await floorReplyText({
    globalConfig: CONFIG,
    text: "Listo, quedó configurado.",
    trace: [{ tool: "read_file" }],
    authorLineFn: async () => { throw new Error("must not be called"); },
  });
  assert.deepEqual(out, { text: "Listo, quedó configurado.", authored: false, floored: false });
});

test("floor: an empty closing is written by the model, from what the turn did", async () => {
  const asked = [];
  const out = await floorReplyText({
    globalConfig: CONFIG,
    text: "",
    streamedText: "Reviso eso",
    trace: [{ tool: "read_file" }, { tool: "read_file" }, { tool: "send_email" }],
    authorLineFn: async (o) => { asked.push(o); return "Leí los dos archivos y mandé el mail."; },
  });
  assert.deepEqual(out, { text: "Leí los dos archivos y mandé el mail.", authored: true, floored: true });
  assert.equal(asked.length, 1);
  assert.match(asked[0].context, /Reviso eso/, "it knows what it already said");
  assert.match(asked[0].context, /read_file×2/, "and what it did");
  assert.equal(asked[0].globalConfig, CONFIG, "the language comes off the config, not off each caller");
});

test("floor: the canned line speaks only when the model cannot", async () => {
  // Worked — prose or tools the user saw — so the closing offers to continue.
  const worked = await floorReplyText({
    globalConfig: CONFIG,
    text: "",
    trace: [{ tool: "read_file" }],
    authorLineFn: async () => "",   // engine down: the usual reason the turn is empty
  });
  assert.deepEqual(worked, { text: CONTINUE, authored: false, floored: true });

  // Nothing happened at all, so there is nothing to report — just an ack.
  const nothing = await floorReplyText({
    globalConfig: CONFIG,
    text: "   \n  ",   // whitespace is not an answer
    authorLineFn: async (o) => { assert.equal(o.context, "", "nothing happened, nothing to tell it about"); return ""; },
  });
  assert.deepEqual(nothing, { text: DONE, authored: false, floored: true });
});

test("floor: a project agent's closing is written by the project agent's model", async () => {
  // The thread is in that agent's voice, so the super-agent's model must not be
  // the one that writes its line.
  const asked = [];
  await floorReplyText({
    globalConfig: CONFIG,
    model: "mock:magui",
    text: "",
    authorLineFn: async (o) => { asked.push(o); return "ok"; },
  });
  assert.equal(asked[0].model, "mock:magui");

  // And with no override the super-agent's own model is left to answer for it,
  // which is what author-line.js falls back to.
  const own = [];
  await closingFloorLine({ globalConfig: CONFIG, authorLineFn: async (o) => { own.push(o); return "ok"; } });
  assert.equal("model" in own[0], false);
});

// ── the routes ──────────────────────────────────────────────────────────────

/** A project with one agent, served over both chat routes. */
function serve(root, { storage }) {
  const app = express();
  app.use(express.json());
  const p = { id: 7, name: "northwind", path: root, storagePath: storage, config: null, logMessage: () => {} };
  const router = apiRouter(express, app);
  const ctx = {
    projects: { list: () => [p], get: () => p, rebuild: () => {} },
    project: () => p,
    config: CONFIG,
    plugins: { get: () => null },
    registries: null,
  };
  registerSuperAgent(router, ctx);
  registerExec(router, ctx);
  registerTurns(router, ctx);
  const server = app.listen(0, "127.0.0.1");
  return new Promise((r) => server.once("listening", () => r({
    server, url: `http://127.0.0.1:${server.address().port}`,
  })));
}

/** Read an NDJSON stream to the end. `onEvent` may interrupt mid-flight. */
async function readStream(res, onEvent = null) {
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      events.push(ev);
      if (onEvent) await onEvent(ev, events);
    }
  }
  return events;
}

// `[mock:empty]` is a model that returns no text and no tool calls: runAgent
// re-prompts it MAX_EMPTY_RETRIES times and then hands an empty turn back.
const EMPTY = "[mock:empty]";
/** The floored line is the mock echoing the instruction it was given. */
const AUTHORED = /came back empty/;

test("web: the blocking super-agent route never answers with nothing", async () => {
  const root = makeTempProject({ name: "northwind" });
  const { server, url } = await serve(root, { storage: path.join(TMP_HOME, ".apx", "projects", "7") });
  try {
    const res = await fetch(`${url}/api/projects/7/super-agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: EMPTY, channel: "web", confirm: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.text, AUTHORED, "the closing is the model's to word");
    assert.notEqual(body.text, DONE, "and the canned line is not the first answer");

    // And it is on the record as the answer, not as an empty row.
    const thread = readGlobalThread({ channel: "web", date: TODAY, project: "7" });
    const last = thread.messages.filter((m) => m.role === "assistant").pop();
    assert.equal(last.content, body.text, "the thread keeps what the user was shown");
  } finally {
    server.close();
  }
});

test("web: the streamed super-agent route never ends on an empty final", async () => {
  const root = makeTempProject({ name: "northwind" });
  const { server, url } = await serve(root, { storage: path.join(TMP_HOME, ".apx", "projects", "7") });
  try {
    const res = await fetch(`${url}/api/projects/7/super-agent/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: EMPTY, channel: "web_sidebar", confirm: false }),
    });
    const events = await readStream(res);
    const final = events.find((e) => e.type === "final");
    assert.ok(final, `the stream must finish, got: ${events.map((e) => e.type).join(",")}`);
    assert.match(final.result.text, AUTHORED, "the bubble the panel renders is not empty");

    const thread = readGlobalThread({ channel: "web_sidebar", date: TODAY, project: "7" });
    const last = thread.messages.filter((m) => m.role === "assistant").pop();
    assert.equal(last.content, final.result.text);
  } finally {
    server.close();
  }
});

test("web: a project agent's empty turn is closed too, on both shapes", async () => {
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-agent-"));
  const root = makeTempProject({ name: "northwind", agents: [{ slug: "magui", role: "Tester", model: "mock" }] });
  const { server, url } = await serve(root, { storage });
  try {
    // Blocking.
    const res = await fetch(`${url}/api/projects/7/agents/magui/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: EMPTY, channel: "web" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.text, AUTHORED);

    // The thread the user reopens holds the same line — an empty assistant turn
    // there is what the NEXT turn would read back as this one's answer.
    const conv = readConversation(storage, "magui", body.conversation_id);
    const assistant = conv.turns.filter((x) => x.role === "assistant");
    assert.equal(assistant.length, 1);
    assert.equal(assistant[0].content, body.text);

    // Streamed.
    const streamed = await fetch(`${url}/api/projects/7/agents/magui/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: EMPTY, channel: "web", confirm: false }),
    });
    const events = await readStream(streamed);
    const final = events.find((e) => e.type === "final");
    assert.ok(final, `the stream must finish, got: ${events.map((e) => e.type).join(",")}`);
    assert.match(final.result.text, AUTHORED);
    const conv2 = readConversation(storage, "magui", final.result.conversation_id);
    assert.equal(conv2.turns.filter((x) => x.role === "assistant")[0].content, final.result.text);
  } finally {
    server.close();
  }
});

test("web: an interrupted turn that wrote nothing still leaves no bubble", async () => {
  // The floor's one exception. An empty turn is a failure to answer and gets a
  // closing; an interruption is the user withdrawing the question, and the
  // answer to a withdrawn question is silence — not a line explaining itself.
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-abort-"));
  const root = makeTempProject({ name: "northwind", agents: [{ slug: "magui", role: "Tester", model: "mock" }] });
  const { server, url } = await serve(root, { storage });
  try {
    const res = await fetch(`${url}/api/projects/7/agents/magui/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Held in the engine, so there is a turn to stop and nothing streamed yet.
      body: JSON.stringify({ prompt: "hola [mock:slow:2000]", channel: "web", confirm: false }),
    });
    let stopped = false;
    const events = await readStream(res, async (ev) => {
      if (stopped || !ev.conversation_id) return;
      stopped = true;
      await fetch(`${url}/api/projects/7/turns/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: ev.conversation_id }),
      });
    });

    const aborted = events.find((e) => e.type === "aborted");
    assert.ok(aborted, `the stream must end as aborted, got: ${events.map((e) => e.type).join(",")}`);
    assert.equal(aborted.result.text, "", "nothing was written, so nothing is claimed");

    const convId = listConversations(storage, "magui")[0]?.id;
    const conv = readConversation(storage, "magui", convId);
    assert.deepEqual(
      conv.turns.filter((x) => x.role === "assistant"),
      [],
      "an interrupted turn that wrote nothing leaves no assistant row",
    );
  } finally {
    server.close();
  }
});
