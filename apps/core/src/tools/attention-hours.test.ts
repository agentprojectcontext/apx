import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const TOKEN = "123456:TEST-hours";

// Each owner message names the tool call the scripted model makes; the tool's result comes back as the answer.
const CALLS: Record<string, object> = {
  "when do you answer?": {},
  "set my hours": {
    channel: "Acme bot",
    hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" },
    contacts: ["Dad", "neighbor"],
    any_hour: true,
  },
  "make the neighbor wait": { contacts: ["Acme Neighbor"], any_hour: false },
  "answer at any hour": { channel: "tg", hours: null },
  "hours for nowhere": { channel: "Nowhere", hours: { days: [1], from: "09:00", to: "10:00" } },
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const call = CALLS[said];
  return call ? callTool("c1", "attention_hours", call) : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
let dad = "";
let neighbor = "";

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  await env.client.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", label: "Acme bot", agent_id: "roby", strangers: "ask", research: "off" },
    token: TOKEN,
  });
  dad = (await env.client.call("contacts.set", { name: "Northwind Dad", nickname: "Dad", relation: "family" })).id;
  neighbor = (await env.client.call("contacts.set", { name: "Acme Neighbor" })).id;
  await env.client.call("agents.create", { slug: "acme-writer", name: "Acme Writer", prompt: "Write." });
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

/** The owner asks; `decision` answers the confirmation the call waits on, and returns what the card said. */
async function ask(text: string, agent = "roby", decision?: "approve" | "deny") {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: agent, title: "Hours" });
  await env.client.call("threads.send", { thread: thread.id, text });
  let detail: string | undefined;
  if (decision) {
    const pending: Array<{ id: string; tool?: string | undefined; detail?: string | undefined }> = await inputsOrEnd(
      env.client,
      thread.id,
    );
    assert.equal(pending[0]?.tool, "attention_hours");
    detail = pending[0]?.detail;
    await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision });
  }
  await env.settle(thread.id);
  return { answer: String(llm.calls.at(-1)?.messages.at(-1)?.content), detail };
}

const channel = async () => (await env.client.call("channels.list", {})).channels.find((c) => c.id === "tg");
const person = async (id: string) => (await env.client.call("contacts.list", {})).persons.find((p) => p.id === id);

test("only the super-agent is offered attention_hours", async () => {
  const offered = async (agent: string) => {
    await ask("hello", agent);
    return llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
  };
  assert.ok((await offered("roby")).includes("attention_hours"));
  assert.ok(!(await offered("acme-writer")).includes("attention_hours"));
});

test("reading the hours asks nobody", async () => {
  const { answer } = await ask("when do you answer?");
  assert.match(answer, /Acme bot \[tg\]: at any hour/);
  assert.match(answer, /Answered at any hour: nobody/);
});

test("the owner approves hours and exceptions read in words, and the channel keeps its other settings", async () => {
  const { answer, detail } = await ask("set my hours", "roby", "approve");
  assert.match(detail ?? "", /Acme bot: answers contacts Mon–Fri 09:00–18:00/);
  assert.match(detail ?? "", /Answered at any hour: Northwind Dad, Acme Neighbor/);
  assert.match(answer, /Saved\./);
  const ch = await channel();
  assert.deepEqual(ch?.hours, { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" });
  assert.equal(ch?.strangers, "ask");
  assert.equal(ch?.research, "off");
  assert.equal(ch?.token_set, true);
  assert.equal((await person(dad))?.any_hour, true);
  assert.equal((await person(neighbor))?.any_hour, true);
});

test("a declined change saves nothing", async () => {
  await ask("make the neighbor wait", "roby", "deny");
  assert.equal((await person(neighbor))?.any_hour, true);
});

test("a contact stops passing the hours, and a channel goes back to any hour", async () => {
  await ask("make the neighbor wait", "roby", "approve");
  assert.equal((await person(neighbor))?.any_hour, false);
  assert.equal((await person(dad))?.any_hour, true);
  await ask("answer at any hour", "roby", "approve");
  const ch = await channel();
  assert.equal(ch?.hours, undefined);
  assert.equal(ch?.strangers, "ask");
});

test("a channel that is not there is refused before the owner is asked", async () => {
  const { answer } = await ask("hours for nowhere");
  assert.match(answer, /no channel "Nowhere"/);
});
