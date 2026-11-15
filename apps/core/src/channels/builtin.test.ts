import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function isolated(script: string): unknown {
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("unused channel transports stay unloaded; a configured adapter loads once and keeps accounts distinct", () => {
  const result = isolated(`
    import { registerHooks } from "node:module";
    import path from "node:path";
    const loaded = [];
    registerHooks({ load(url, context, next) {
      if (url.startsWith("file:")) loaded.push(path.basename(new URL(url).pathname));
      return next(url, context);
    }});
    await import(${JSON.stringify(new URL("../server.ts", import.meta.url).href)});
    const builtin = await import(${JSON.stringify(new URL("./builtin.ts", import.meta.url).href)});
    const before = [...loaded];
    const config = { id: "channel-test", type: "telegram", label: "Acme", agent_id: "superagent", enabled: true };
    const adapter = builtin.telegramAdapter(config, "test-token", "http://127.0.0.1:1");
    const after = [...loaded];
    const again = builtin.telegramAdapter(config, "test-token", "http://127.0.0.1:1");
    console.log(JSON.stringify({ before, after, final: loaded, caps: adapter.caps, again: again.caps, fresh: adapter !== again }));
  `) as { before: string[]; after: string[]; final: string[]; caps: object; again: object; fresh: boolean };
  const transports = ["telegram.ts", "whatsapp.ts", "discord.ts", "email.ts", "matrix.ts", "slack.ts"];
  assert.deepEqual(
    result.before.filter((name) => transports.includes(name)),
    [],
  );
  assert.ok(!result.before.includes("cdp.ts"));
  assert.ok(!result.before.includes("cdp-edit.ts"));
  assert.ok(result.after.includes("telegram.ts"));
  assert.ok(!result.after.includes("whatsapp.ts"));
  assert.deepEqual(result.final, result.after);
  assert.deepEqual(result.caps, result.again);
  assert.equal(result.fresh, true);
});

test("a deferred transport sends through its configured endpoint and token", () => {
  const result = isolated(`
    import http from "node:http";
    const { telegramAdapter } = await import(${JSON.stringify(new URL("./builtin.ts", import.meta.url).href)});
    const requests = [];
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const part of req) body += part;
      requests.push({ url: req.url, body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: { message_id: 42 } }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const config = { id: "channel-test", type: "telegram", label: "Acme", agent_id: "superagent", enabled: true };
      const adapter = telegramAdapter(config, "test-token", "http://127.0.0.1:" + server.address().port);
      const sent = await adapter.send("test-chat", { text: "Hello" });
      await adapter.stop();
      console.log(JSON.stringify({ requests, sent }));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  `) as { requests: { url: string; body: { chat_id: string; text: string } }[]; sent: { external_id: string } };
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0]?.url, "/bottest-token/sendMessage");
  assert.equal(result.requests[0]?.body.chat_id, "test-chat");
  assert.equal(result.requests[0]?.body.text, "Hello");
  assert.deepEqual(result.sent, { external_id: "42" });
});

test("numbering plans load only for a supplied phone number and still validate it", () => {
  const result = isolated(`
    import { registerHooks } from "node:module";
    let loads = 0;
    registerHooks({ load(url, context, next) {
      if (url.includes("libphonenumber-js")) loads++;
      return next(url, context);
    }});
    const phone = await import(${JSON.stringify(new URL("./phone.ts", import.meta.url).href)});
    phone.countryOf(undefined);
    phone.whatsappDigits("abc");
    const before = loads;
    const country = phone.countryOf("14155552671");
    const digits = phone.whatsappDigits("+1 415 555 2671");
    console.log(JSON.stringify({ before, after: loads, country, digits }));
  `) as { before: number; after: number; country: string; digits: { digits: string } };
  assert.equal(result.before, 0);
  assert.ok(result.after > 0);
  assert.equal(result.country, "US");
  assert.deepEqual(result.digits, { digits: "14155552671" });
});
