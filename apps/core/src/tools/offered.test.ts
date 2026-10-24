import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { CODEX_IMAGE_SERVICE } from "../services/codex-images.ts";

// Tools that need something set up are offered once it is: every model call pays for each schema it carries.
const CHANNEL_TOOLS = [
  "message_contact",
  "channel_post",
  "channel_list",
  "contact_list",
  "contact_requests",
  "answer_contact_request",
  "voice_replies",
];
const TOKEN = "123456:TEST-offered";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

async function turn() {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "hola" });
  await env.settle(t.id);
  const call = llm.calls.at(-1);
  return { tools: call?.tools.map((x) => x.function.name) ?? [], system: String(call?.messages[0]?.content) };
}

test("with no channel on, the channel and contact tools and their rule stay out; suggest_connection stays in", async () => {
  const { tools, system } = await turn();
  for (const name of CHANNEL_TOOLS) assert.ok(!tools.includes(name), name);
  assert.ok(tools.includes("suggest_connection"));
  assert.doesNotMatch(system, /Channels are the apps APX talks through/);
});

test("a channel on brings them, and one turned off takes them away again", async () => {
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  const on = await turn();
  for (const name of CHANNEL_TOOLS) assert.ok(on.tools.includes(name), name);
  assert.match(on.system, /Channels are the apps APX talks through/);
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", agent_id: "roby", enabled: false },
  });
  const off = await turn();
  for (const name of CHANNEL_TOOLS) assert.ok(!off.tools.includes(name), name);
});

test("make_image is offered only with an image service on", async () => {
  assert.ok(!(await turn()).tools.includes("make_image"));
  env.core.store.settings.write("services", [{ ...CODEX_IMAGE_SERVICE, id: "codex" }]);
  assert.ok((await turn()).tools.includes("make_image"));
  env.core.store.settings.write("services", [{ ...CODEX_IMAGE_SERVICE, id: "codex", enabled: false }]);
  assert.ok(!(await turn()).tools.includes("make_image"));
});
