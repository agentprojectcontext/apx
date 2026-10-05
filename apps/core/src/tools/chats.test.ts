import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`seen: ${String(req.messages.at(-1)?.content)}`);
  if (said === "find it") return callTool("s1", "search_chats", { query: "dentist appointment" });
  if (said === "read it") return callTool("r1", "read_chat", { chat: "Errands" });
  if (said === "read nothing") return callTool("r2", "read_chat", { chat: "no such chat" });
  return say("noted");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Errands" });
  await env.client.call("threads.send", { thread: other.id, text: "my dentist appointment is on Friday at five" });
  await env.settle(other.id);
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const lastText = async () => {
  const t = await env.settle("home");
  return (
    t.messages
      .at(-1)
      ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("") ?? ""
  );
};

test("an agent finds what the owner said in another chat, as outside content, with the chat to read", async () => {
  await env.client.call("threads.send", { thread: "home", text: "find it" });
  const text = await lastText();
  assert.match(text, /<chats [^>]*trust="untrusted"/);
  assert.match(text, /\[Errands · chat [^\]]+\] .* Owner: .*dentist appointment/);
});

test("an agent reads another chat by its title, each message with who said it", async () => {
  await env.client.call("threads.send", { thread: "home", text: "read it" });
  const text = await lastText();
  assert.match(text, /<chat title="Errands"/);
  assert.match(text, /Owner: my dentist appointment is on Friday at five/);
  assert.match(text, /Roby: noted/);
});

test("a chat that does not exist lists the ones the agent can read", async () => {
  await env.client.call("threads.send", { thread: "home", text: "read nothing" });
  assert.match(await lastText(), /no chat named "no such chat"[\s\S]*Errands/);
});
