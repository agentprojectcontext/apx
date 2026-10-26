import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import type { AssistantItem } from "../providers/types.ts";
import { splitSpoken } from "../services/audio.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-ack";
const OWNER = { id: 5005, name: "Owner" };

/** "On it" in the agent's own words, then a tool, then the answer. */
const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("Three open tasks, none due today.");
  if (said.includes("what is pending")) {
    const message: AssistantItem = {
      role: "assistant",
      content: "Dale, lo miro.",
      tool_calls: [{ id: "t1", type: "function", function: { name: "task_list", arguments: "{}" } }],
    };
    return { message };
  }
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  tg.message(OWNER, "hola");
  await waitFor(() => tg.messagesTo(OWNER.id).length === 1, "pairing code");
  const code = /(\d{6})/.exec(String(tg.messagesTo(OWNER.id)[0]?.body.text))?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "owner" });
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("on Telegram the owner hears 'on it' as soon as the agent starts working, then the answer without it", async () => {
  const before = tg.messagesTo(OWNER.id).length;
  tg.message(OWNER, "what is pending?");
  await waitFor(() => tg.messagesTo(OWNER.id).some((m) => /Three open tasks/.test(String(m.body.text))), "the answer");
  const sent = tg
    .messagesTo(OWNER.id)
    .slice(before)
    .map((m) => String(m.body.text));
  assert.deepEqual(sent, ["Dale, lo miro.", "Three open tasks, none due today."]);
  assert.match(
    String(llm.calls.at(0)?.messages[0]?.content),
    /When your owner writes on telegram: .*Before your first tool call/,
  );
  assert.doesNotMatch(String(llm.calls.at(0)?.messages.at(-1)?.content), /Before your first tool call/);
});

test("a spoken answer: the first paragraph (to a sentence end) is the voice note, the rest stays as written", () => {
  const long = `${"Primero esto. ".repeat(20)}Y esto sigue.`;
  const a = splitSpoken(`**Listo**, ya está.\n\nDetalles:\n- uno\n- dos`);
  assert.deepEqual(a, { spoken: "Listo, ya está.", rest: "Detalles:\n- uno\n- dos" });
  const b = splitSpoken(long, 60);
  assert.equal(b.spoken, "Primero esto. Primero esto. Primero esto. Primero esto.");
  assert.ok(b.rest.endsWith("Y esto sigue."));
  assert.equal(b.spoken.length + b.rest.length + 1, long.trim().length);
  assert.deepEqual(splitSpoken("```\ncode\n```\n\nDespués."), { spoken: "Después.", rest: "```\ncode\n```" });
});
