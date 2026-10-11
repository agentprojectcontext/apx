// A background runtime's answer reaches the chat whole (#65).
//
// Three ways it used to be lost, each pinned below: the callback relayed a
// 200-character status line instead of the answer; the direct Telegram path cut
// what was left at 3500 characters; and a text over Telegram's 4096 limit was
// sent as one message, refused, and the refusal only reached the daemon log.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-callback-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeToolHandlers } = await import("#core/agent/tools/registry.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
const { sendFormatted, formatTelegram } = await import("#core/channels/telegram/format.js");
const { clipRuntimeText } = await import("#core/agent/runtime-thread.js");
const telegramPlugin = (await import("#host/daemon/plugins/telegram/index.js")).default;

const CHAT_ID = "1234567890";
const MARKER = "MARCADOR_FINAL_7Q2";

/** A long answer: numbered paragraphs, the marker as its very last words. */
function longAnswer(chars) {
  const parts = [];
  let n = 0;
  while (parts.join("\n\n").length < chars) {
    parts.push(`Párrafo ${n}: ${"el relevamiento sigue con más detalle ".repeat(8).trim()}.`);
    n += 1;
  }
  return `${parts.join("\n\n")}\n\n${MARKER}`;
}

function ledgerRows(channel) {
  const dir = path.join(process.env.APX_HOME, "messages", channel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) =>
    fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}

/** Resolves once `check` returns something truthy; the background delivery is not awaited by the tool. */
async function waitFor(check, what) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** An `aider` on PATH that prints `answer`, and answers the availability probe. */
async function withFakeAider(answer, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-callback-bin-"));
  const out = path.join(dir, "answer.txt");
  fs.writeFileSync(out, answer);
  const bin = path.join(dir, "aider");
  fs.writeFileSync(bin, `#!/bin/sh\ncase "$*" in *--version*) echo "aider 0.0.0"; exit 0;; esac\ncat "${out}"\n`, { mode: 0o755 });
  const oldPath = process.env.PATH || "";
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function setup() {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "roby", role: "Coordinator", model: "mock:test" }] });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  return { root, projects };
}

function telegramHandlers(projects, { plugins = null, backgroundResultSink = null } = {}) {
  return makeToolHandlers({
    projects,
    plugins,
    registries: null,
    globalConfig: { super_agent: { permission_mode: "total" } },
    channel: "telegram",
    channelMeta: { chatId: CHAT_ID },
    backgroundResultSink,
  });
}

/** The real Telegram plugin over a fake Bot API that enforces the 4096 limit. */
function fakeTelegram(respond) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const json = respond(body);
    return { ok: json.ok, status: json.ok ? 200 : 400, json: async () => json };
  };
  const plugin = telegramPlugin.init({
    projects: { list: () => [], get: () => null, getByPath: () => null },
    config: { telegram: { enabled: false, channels: [{ name: "main", bot_token: "123:fake", chat_id: CHAT_ID }] } },
    log: () => {},
    plugins: null,
    registries: null,
  });
  return { calls, plugins: { get: (n) => (n === "telegram" ? plugin : null) }, restore: () => { global.fetch = original; } };
}

const enforceLimit = (body) =>
  body.text.length > 4096
    ? { ok: false, description: "Bad Request: message is too long" }
    : { ok: true, result: { message_id: 1 } };

test("the A2A relay gets the runtime's whole answer, not a 200-character preview", async () => {
  const { root, projects } = setup();
  const answer = longAnswer(7000);
  let report = null;
  try {
    await withFakeAider(answer, async () => {
      const r = await telegramHandlers(projects, { backgroundResultSink: async (text) => { report = text; } })
        .call_runtime({ runtime: "aider", prompt: "escribí el relevamiento completo" });
      assert.equal(r.status, "launched");
      await waitFor(() => report, "the A2A report");
    });
    assert.ok(report.includes(answer), "the whole answer is in the report, marker included");
    assert.ok(!report.includes("Recortado"), "nothing was cut at this size");
  } finally {
    cleanupTempProject(root);
  }
});

test("the direct Telegram callback delivers a long answer complete, as ordered messages under 4096", async () => {
  const { root, projects } = setup();
  const answer = longAnswer(9000);
  const tg = fakeTelegram(enforceLimit);
  try {
    await withFakeAider(answer, async () => {
      await telegramHandlers(projects, { plugins: tg.plugins })
        .call_runtime({ runtime: "aider", prompt: "escribí el relevamiento completo" });
      await waitFor(() => tg.calls.some((c) => c.text.includes(MARKER)), "the last message");
    });
    assert.ok(tg.calls.length > 2, `split into several messages (got ${tg.calls.length})`);
    for (const c of tg.calls) assert.ok(c.text.length <= 4096, `a message of ${c.text.length} chars was sent`);
    assert.ok(tg.calls.at(-1).text.endsWith(MARKER), "the marker arrives last");
    const delivered = tg.calls.map((c) => c.text).join("\n\n");
    assert.ok(delivered.includes(answer), "every paragraph arrived, in order");
    assert.ok(!ledgerRows("telegram").some((row) => row.meta?.runtime_phase === "delivery_failed"));
  } finally {
    tg.restore();
    cleanupTempProject(root);
  }
});

test("a Telegram delivery that fails is recorded on the thread, apart from the session's own outcome", async () => {
  const { root, projects } = setup();
  const tg = fakeTelegram(() => ({ ok: false, description: "Forbidden: bot was blocked by the user" }));
  try {
    await withFakeAider(longAnswer(500), async () => {
      await telegramHandlers(projects, { plugins: tg.plugins })
        .call_runtime({ runtime: "aider", prompt: "escribí el relevamiento" });
      const failed = await waitFor(
        () => ledgerRows("telegram").find((row) => row.meta?.runtime_phase === "delivery_failed"),
        "the delivery-failure row",
      );
      assert.match(failed.meta.delivery_error, /bot was blocked/);
      assert.equal(failed.meta.delivery_via, "Telegram");
      const done = ledgerRows("telegram").find((row) => row.meta?.runtime_phase === "done" && row.meta.apc_session === failed.meta.apc_session);
      assert.ok(done, "the session itself is still recorded as finished");
    });
  } finally {
    tg.restore();
    cleanupTempProject(root);
  }
});

test("sendFormatted splits text over 4096 into ordered messages, keyboard on the last", async () => {
  const sent = [];
  const fake = async (_t, _c, body) => {
    if (body.text.length > 4096) throw new Error("Bad Request: message is too long");
    sent.push(body);
    return { message_id: sent.length };
  };
  const text = longAnswer(10_000);
  const keyboard = { inline_keyboard: [[{ text: "Ok", callback_data: "ok" }]] };
  const res = await sendFormatted(fake, "tok", 1, { text, reply_markup: keyboard });
  assert.ok(sent.length >= 3);
  assert.equal(sent.map((b) => b.text).join("\n\n"), text, "cut at paragraph breaks, nothing lost or reordered");
  assert.deepEqual(sent.at(-1).reply_markup, keyboard);
  assert.ok(sent.slice(0, -1).every((b) => !b.reply_markup), "only the last message carries the keyboard");
  assert.equal(res.message_id, sent.length, "the last message's result is returned");

  // A failure partway says how much already went out.
  let n = 0;
  await assert.rejects(
    sendFormatted(async () => { n += 1; if (n === 2) throw new Error("Too Many Requests"); return {}; }, "t", 1, { text }),
    (e) => e.partsSent === 1 && /part 2 of/.test(e.message),
  );
});

test("a code block cut between two messages is closed and reopened, so both render", async () => {
  const lines = Array.from({ length: 400 }, (_, i) => `const v${i} = ${i}; // valor`);
  const text = `Así quedó:\n\n\`\`\`js\n${lines.join("\n")}\n\`\`\`\n\nListo.`;
  const sent = [];
  await sendFormatted(async (_t, _c, body) => { sent.push(body); return {}; }, "t", 1, { text });
  assert.ok(sent.length >= 2);
  for (const b of sent) {
    assert.ok(b.text.length <= 4096);
    assert.equal(b.parse_mode, "HTML");
    assert.equal((b.text.match(/<pre>/g) || []).length, (b.text.match(/<\/pre>/g) || []).length, "every <pre> is closed");
    assert.ok(!b.text.includes("```"), "no raw fence left");
  }
  const code = sent.map((b) => b.text).join("\n");
  for (const i of [0, 199, 399]) assert.ok(code.includes(`const v${i} = ${i};`), `line ${i} arrived`);
  assert.equal(formatTelegram("corto").text, "corto");
});

test("an answer past the relay limit is cut with a note naming the session, never silently", () => {
  const text = "a".repeat(13_000);
  const clipped = clipRuntimeText(text, 12_000, "s_0001");
  assert.ok(clipped.startsWith("a".repeat(12_000)));
  assert.match(clipped, /Recortado: se muestran 12000 de 13000 caracteres/);
  assert.match(clipped, /`s_0001`/);
  assert.equal(clipRuntimeText("corto", 12_000, "s_0001"), "corto");
});
