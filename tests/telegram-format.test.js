// Telegram shows markdown as written (#61): every message went out with no
// parse_mode, so `**t_abc123**` and backticks around a session id reached the
// phone literally. Formatting now happens at the one boundary all text passes
// (the poller's _send), and the regression below drives the REAL notification
// path — the plugin's send(), reached from the callback reconciler — not only
// the formatter.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tg-format-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { formatTelegram, plainTelegram, sendFormatted } = await import("#core/channels/telegram/format.js");
const telegramPlugin = (await import("#host/daemon/plugins/telegram/index.js")).default;
const { writePendingCallback, listPendingCallbacks } = await import("#core/stores/runtime-callbacks.js");
const { reconcilePendingCallbacks } = await import("#host/daemon/callback-reconciler.js");

const SAMPLE = [
  "Terminó la auditoría de **t_abc123** (sesión `s_0001`).",
  "",
  "Pendientes:",
  "- corregir `design.md` §3",
  "- decidir el umbral de alertas",
  "",
  "Detalle en [el plan](https://example.com/plan) · costo < 5 & listo.",
].join("\n");

test("bold, inline code, links, paragraphs and lists render without raw delimiters", () => {
  const f = formatTelegram(SAMPLE);
  assert.equal(f.parse_mode, "HTML");
  assert.match(f.text, /<b>t_abc123<\/b>/);
  assert.match(f.text, /<code>s_0001<\/code>/);
  assert.match(f.text, /<a href="https:\/\/example\.com\/plan">el plan<\/a>/);
  assert.match(f.text, /• corregir <code>design\.md<\/code> §3/);
  assert.match(f.text, /costo &lt; 5 &amp; listo/);
  assert.ok(!/\*\*|`/.test(f.text), "no markdown delimiters left");
  assert.match(f.text, /\)\.\n\nPendientes:/, "paragraphs kept");
});

test("plain text goes out byte-identical, ids with underscores untouched", () => {
  const plain = "Listo: t_abc123 quedó en revisión.\n- uno\n- dos\nsnake_case_name sin cambios < 3";
  assert.deepEqual(formatTelegram(plain), { text: plain });
  assert.equal(plainTelegram(plain), plain);
});

test("malformed markdown never throws and stays readable", () => {
  for (const s of ["**sin cerrar", "`abierto", "a * b * c", "<script>x</script> **ok**", ""]) {
    const f = formatTelegram(s);
    assert.equal(typeof f.text, "string");
    if (f.parse_mode) assert.ok(!f.text.includes("<script>"), "HTML is escaped");
  }
  assert.equal(plainTelegram("**hecho** con `x` y [link](https://example.com)"), "hecho con x y link (https://example.com)");
});

test("if Telegram refuses the entities, the same message is resent as plain text", async () => {
  const calls = [];
  const fake = async (_t, _c, body) => {
    calls.push(body);
    if (body.parse_mode) throw new Error("Bad Request: can't parse entities: unsupported start tag");
    return { message_id: 1 };
  };
  await sendFormatted(fake, "tok", 1, { text: "**hola** `x`" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].parse_mode, undefined);
  assert.equal(calls[1].text, "hola x");

  // Any other failure is not swallowed.
  await assert.rejects(sendFormatted(async () => { throw new Error("chat not found"); }, "t", 1, { text: "**x**" }), /chat not found/);
  // A caller's own parse_mode is respected as given.
  const own = [];
  await sendFormatted(async (_t, _c, b) => { own.push(b); }, "t", 1, { text: "*x*", parse_mode: "Markdown" });
  assert.deepEqual(own[0], { text: "*x*", reply_markup: undefined, parse_mode: "Markdown" });
});

test("the runtime-completion notification reaches Telegram rendered (reconciler → plugin.send)", async () => {
  const bodies = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) };
  };
  try {
    const plugin = telegramPlugin.init({
      projects: { list: () => [], get: () => null, getByPath: () => null },
      config: { telegram: { enabled: false, channels: [{ name: "main", bot_token: "123:fake", chat_id: "1234567890" }] } },
      log: () => {},
      plugins: null,
      registries: null,
    });
    const sess = path.join(TMP_HOME, "session.md");
    fs.writeFileSync(sess, "---\nstatus: completed\ncompleted: 2020-01-01T00:00:00Z\nresult: listo **t_abc123** revisada\n---\n");
    writePendingCallback({ session_id: "s_0001", session_path: sess, channel: "telegram", chat_id: "1234567890", runtime: "codex", who: "codex" });

    await reconcilePendingCallbacks({ plugins: { get: (n) => (n === "telegram" ? plugin : null) }, log: () => {} });
    const sent = bodies.find((b) => b.text?.includes("t_abc123"));
    assert.ok(sent, "the notification was sent");
    assert.equal(sent.parse_mode, "HTML");
    assert.match(sent.text, /<code>s_0001<\/code>/);
    assert.match(sent.text, /<b>t_abc123<\/b>/);
    assert.ok(!/\*\*|`/.test(sent.text));
    assert.equal(listPendingCallbacks().length, 0);
  } finally {
    global.fetch = original;
  }
});
