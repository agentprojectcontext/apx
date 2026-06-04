// Unit tests for the telegram-channel CRUD helpers in src/core/config.js
// and for the apx telegram channel CLI commands (with a mocked http client).
//
// We deliberately don't spin up the daemon — the CLI commands import the
// shared http module, so we override its methods in-process and inspect what
// the command would have sent.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Force a per-test APX home so we never touch the real ~/.apx/config.json.
// Each `import.meta.resolve` of core/config.js reads APX_HOME from
// `os.homedir()`, which we point at a tmpdir before the import.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tg-channels-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome; // Windows safety net

const {
  readConfig,
  writeConfig,
  upsertTelegramChannel,
  removeTelegramChannel,
  unsetTelegramChannelFields,
  findTelegramChannel,
  listTelegramChannels,
} = await import("../src/core/config.js");

test("upsertTelegramChannel creates a channel with default respond_with_engine", () => {
  const cfg = readConfig();
  const { created, channel } = upsertTelegramChannel(cfg, "support", {
    bot_token: "T",
    chat_id: "123",
  });
  assert.equal(created, true);
  assert.equal(channel.name, "support");
  assert.equal(channel.bot_token, "T");
  assert.equal(channel.chat_id, "123");
  assert.equal(channel.respond_with_engine, true);

  // Persisted on disk
  const reread = readConfig();
  assert.equal(reread.telegram.channels.length, 1);
  assert.equal(reread.telegram.channels[0].name, "support");
});

test("upsertTelegramChannel patches an existing channel without dropping fields", () => {
  const cfg = readConfig();
  upsertTelegramChannel(cfg, "support", { project: "/tmp/p", route_to_agent: "sofia" });

  const cfg2 = readConfig();
  const ch = findTelegramChannel(cfg2, "support");
  assert.equal(ch.bot_token, "T", "untouched fields must remain");
  assert.equal(ch.project, "/tmp/p");
  assert.equal(ch.route_to_agent, "sofia");
});

test("unsetTelegramChannelFields removes only requested optional fields", () => {
  const cfg = readConfig();
  const result = unsetTelegramChannelFields(cfg, "support", ["route_to_agent", "project"]);
  assert.ok(result);
  assert.equal("route_to_agent" in result.channel, false);
  assert.equal("project" in result.channel, false);
  assert.equal(result.channel.bot_token, "T", "non-targeted fields stay");
});

test("listTelegramChannels returns a defensive copy of the array", () => {
  const cfg = readConfig();
  const list = listTelegramChannels(cfg);
  list.push({ name: "ghost" });
  const re = readConfig();
  assert.equal(re.telegram.channels.some((c) => c.name === "ghost"), false);
});

test("removeTelegramChannel reports removed=1 and clears persisted entry", () => {
  const cfg = readConfig();
  const { removed } = removeTelegramChannel(cfg, "support");
  assert.equal(removed, 1);
  const re = readConfig();
  assert.equal(re.telegram.channels.length, 0);
});

test("removeTelegramChannel on a missing channel returns removed=0", () => {
  const cfg = readConfig();
  const { removed } = removeTelegramChannel(cfg, "nope");
  assert.equal(removed, 0);
});

test("upsertTelegramChannel drops unknown patch keys", () => {
  const cfg = readConfig();
  const { channel } = upsertTelegramChannel(cfg, "x", {
    bot_token: "tok",
    rogue_field: "ignored",
  });
  assert.equal("rogue_field" in channel, false);
});

// ── CLI command tests (mocked http client) ──────────────────────────────────
// We stub the http module so cmdTelegramChannel* commands send their payloads
// to recorders instead of a live daemon. The /admin/reload call is treated as
// a no-op.

const { http } = await import("../src/interfaces/cli/http.js");
const {
  cmdTelegramChannelList,
  cmdTelegramChannelSet,
  cmdTelegramChannelUnset,
  cmdTelegramChannelRemove,
  cmdTelegramChannelShow,
} = await import("../src/interfaces/cli/commands/telegram.js");

function installHttpStub({ channels = [] } = {}) {
  const calls = [];
  http.get = async (p) => {
    calls.push(["GET", p, null]);
    if (p === "/telegram/channels") return { channels };
    if (p === "/projects") return [];
    return {};
  };
  http.post = async (p, body) => {
    calls.push(["POST", p, body]);
    if (p === "/telegram/channels") return { created: true, channel: { name: body.name, ...body } };
    return { ok: true };
  };
  http.patch = async (p, body) => {
    calls.push(["PATCH", p, body]);
    return { ok: true };
  };
  http.delete = async (p) => {
    calls.push(["DELETE", p, null]);
    return { ok: true };
  };
  return calls;
}

test("cmdTelegramChannelList prints '(no channels …)' when daemon returns empty", async () => {
  installHttpStub({ channels: [] });
  let captured = "";
  const orig = console.log;
  console.log = (...args) => { captured += args.join(" ") + "\n"; };
  try {
    await cmdTelegramChannelList();
  } finally {
    console.log = orig;
  }
  assert.match(captured, /no channels configured/);
});

test("cmdTelegramChannelList prints one line per channel", async () => {
  installHttpStub({
    channels: [
      { name: "a", chat_id: "1", project: "/p", route_to_agent: "sofia", respond_with_engine: true },
      { name: "b", chat_id: "2" },
    ],
  });
  let captured = "";
  const orig = console.log;
  console.log = (...args) => { captured += args.join(" ") + "\n"; };
  try {
    await cmdTelegramChannelList();
  } finally {
    console.log = orig;
  }
  assert.match(captured, /channels \(2\)/);
  assert.match(captured, /a\s+chat=1/);
  assert.match(captured, /agent=sofia/);
  assert.match(captured, /b\s+chat=2/);
});

test("cmdTelegramChannelSet patches via /telegram/channels/:name and reloads", async () => {
  const calls = installHttpStub();
  await cmdTelegramChannelSet({
    _: ["clientes"],
    flags: { project: "iacrmar", agent: "comercial", "respond-engine": "false" },
  });
  const patch = calls.find((c) => c[0] === "PATCH" && c[1].startsWith("/telegram/channels/"));
  assert.ok(patch, "PATCH /telegram/channels/:name must be sent");
  assert.deepEqual(patch[2], {
    project: "iacrmar",
    route_to_agent: "comercial",
    respond_with_engine: false,
  });
  assert.ok(calls.find((c) => c[0] === "POST" && c[1] === "/admin/reload"), "reload must be triggered");
});

test("cmdTelegramChannelSet without flags throws a helpful error", async () => {
  installHttpStub();
  await assert.rejects(
    () => cmdTelegramChannelSet({ _: ["clientes"], flags: {} }),
    /nothing to update/
  );
});

test("cmdTelegramChannelUnset sends nulls for chosen fields", async () => {
  const calls = installHttpStub();
  await cmdTelegramChannelUnset({
    _: ["clientes"],
    flags: { project: true, agent: true },
  });
  const patch = calls.find((c) => c[0] === "PATCH");
  assert.deepEqual(patch[2], { project: null, route_to_agent: null });
});

test("cmdTelegramChannelRemove deletes by url and reloads", async () => {
  const calls = installHttpStub();
  await cmdTelegramChannelRemove({ _: ["clientes"], flags: {} });
  assert.ok(calls.find((c) => c[0] === "DELETE" && c[1] === "/telegram/channels/clientes"));
  assert.ok(calls.find((c) => c[0] === "POST" && c[1] === "/admin/reload"));
});

test("cmdTelegramChannelShow throws when name not found", async () => {
  installHttpStub({ channels: [{ name: "other" }] });
  await assert.rejects(
    () => cmdTelegramChannelShow({ _: ["clientes"], flags: {} }),
    /no such channel/
  );
});

test("cmdTelegramChannelShow prints JSON for matching channel", async () => {
  installHttpStub({ channels: [{ name: "clientes", chat_id: "1" }] });
  let captured = "";
  const orig = console.log;
  console.log = (...args) => { captured += args.join(" ") + "\n"; };
  try {
    await cmdTelegramChannelShow({ _: ["clientes"], flags: {} });
  } finally {
    console.log = orig;
  }
  assert.match(captured, /"name": "clientes"/);
});
