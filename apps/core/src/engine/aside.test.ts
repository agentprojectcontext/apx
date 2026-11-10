// A side question reads the chat and answers on the chat's model, and nothing of it enters the chat or its later turns.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((req, { said }) => {
  const last = String(req.messages.at(-1)?.content ?? "");
  if (last.includes("Side question:") || last.includes("and the second")) {
    // The aside call: the chat is in it, and no tools.
    return {
      ...say(req.tools.length ? "tools were offered" : `aside answer ${req.messages.length}`),
      usage: { input: 120, output: 8 },
    };
  }
  return say(`main answer to ${said}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a side question answers from the chat and leaves the chat as it was", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  await env.client.call("threads.send", { thread: chat.id, text: "the deploy codeword is Northwind" });
  await env.settle(chat.id);
  const before = await env.client.call("threads.get", { thread: chat.id });

  const first = await env.client.call("threads.aside", { thread: chat.id, question: "what was the codeword?" });
  assert.equal(first.answer, "aside answer 2", "a system prompt and one question");
  const asked = llm.calls.at(-1);
  assert.deepEqual(asked?.tools, [], "no tools in a side question");
  const prompt = String(asked?.messages.at(-1)?.content);
  assert.match(prompt, /<chat>[\s\S]*Northwind[\s\S]*<\/chat>/, "the chat is its context");
  assert.match(prompt, /Side question: what was the codeword\?$/);

  // A follow-up carries the side conversation, the chat only once.
  const second = await env.client.call("threads.aside", {
    thread: chat.id,
    question: "and the second?",
    earlier: [{ question: "what was the codeword?", answer: first.answer }],
  });
  assert.equal(second.answer, "aside answer 4");
  const roles = llm.calls.at(-1)?.messages.map((m) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "user"]);
  assert.equal(String(llm.calls.at(-1)?.messages.at(-1)?.content), "and the second?");

  const after = await env.client.call("threads.get", { thread: chat.id });
  assert.equal(after.messages.length, before.messages.length, "no message added");
  assert.equal(after.runs.length, before.runs.length, "no turn run");
  const listed = (await env.client.call("threads.list", {})).threads.map((t) => t.id);
  assert.equal(listed.filter((id) => id !== chat.id && id !== "home").length, 0, "no other chat appeared");

  // Its tokens are counted with the chat, as a side question.
  const usage = await env.client.call("usage.summary", { thread: chat.id });
  const aside = usage.aux.find((a) => a.purpose === "aside");
  assert.equal(aside?.calls, 2);
  assert.equal(aside?.input, 240);

  // The chat's next turn never sees it.
  await env.client.call("threads.send", { thread: chat.id, text: "go on" });
  await env.settle(chat.id);
  const next = JSON.stringify(llm.calls.at(-1)?.messages);
  assert.ok(next.includes("go on"));
  assert.ok(!next.includes("what was the codeword") && !next.includes("aside answer"), "the next turn never sees it");
});

test("an engine's own session takes no side question", async () => {
  await using repo = tempDir("apx-aside-");
  const project = (await env.client.call("projects.register", { path: repo.path, init: true })).project.id;
  const session = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "superagent",
    project_id: project,
    engine: "claude",
  });
  await assert.rejects(
    env.client.call("threads.aside", { thread: session.id, question: "quick one" }),
    /not available in an engine's own session/,
  );
  await assert.rejects(env.client.call("threads.aside", { thread: "th_missing", question: "hi" }), /not found/);
});
