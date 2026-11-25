import assert from "node:assert/strict";
import { test } from "node:test";
import { createDelegations } from "../engine/delegation.ts";
import { openDisplay } from "../engine/display.ts";
import { callTool, say } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { readingFixture } from "./contact-project-reading.test-support.ts";

const question = "Which dock can accept the delayed pallets?";

test("a second consultation steered into an active session keeps its own question reference", async () => {
  const h = await readingFixture();
  const displays: ReturnType<typeof openDisplay>[] = [];
  try {
    const boss = h.store.agents.get("superagent");
    assert.ok(boss);
    const caller = () => {
      const run = h.store.runs.create({ thread_id: h.thread.id, agent_id: h.agent.id, trigger: "user", depth: 0 });
      const display = openDisplay(
        h.store,
        h.store.messages.add({
          thread_id: h.thread.id,
          run_id: run.id,
          author: { kind: "agent", id: h.agent.id },
          parts: [],
        }),
      );
      displays.push(display);
      return { agent: h.agent, run, display };
    };
    let steered = "";
    const delegation = createDelegations({
      store: h.store,
      kick() {},
      live: new Map(),
      deliver() {},
      ended() {},
      windowMs: () => 60000,
      steer(input) {
        steered = input.text ?? "";
        return h.store.runs.list(input.thread_id, 5).find((r) => r.state === "working");
      },
    });
    const first = caller();
    await delegation.delegate(
      first,
      { agent: boss, session: "contact-consult", question },
      "Private context plus the first question",
      0,
    );
    const card = first.display.message.parts.find((p) => p.type === "subthread");
    assert.ok(card);
    const child = h.store.runs.list(card.thread_id, 1)[0];
    assert.ok(child);
    h.store.runs.setState(child, "working");
    const nextQuestion = "Is the north dock still available?";
    const second = caller();
    const result = await delegation.delegate(
      second,
      { agent: boss, session: "contact-consult", question: nextQuestion },
      "Private context plus the second question",
      0,
    );
    assert.match(result, /^sent: .*still working/);
    assert.equal(steered, "Private context plus the second question");
    const visible = h.store.messages
      .list(card.thread_id, 10)
      .flatMap((m) => m.parts)
      .filter((p) => p.type === "text")
      .map((p) => p.text);
    assert.deepEqual(visible, [question, nextQuestion]);
    const next = second.display.message.parts.find((p) => p.type === "subthread");
    assert.ok(next, "the new caller message links the active conversation too");
    assert.equal(next.thread_id, card.thread_id);
    assert.equal(next.question, nextQuestion);
    assert.equal(next.title, nextQuestion);
    assert.equal(first.display.message.parts.find((p) => p.type === "subthread")?.question, question);
    assert.equal(h.store.runs.list(card.thread_id, 5).length, 1, "steering does not create a duplicate run");
    assert.ok(h.store.threads.get(card.thread_id)?.title.includes(nextQuestion));
  } finally {
    for (const display of displays) display.close();
    await h.close();
  }
});

test("a contact consultation displays its actual question and keeps private instructions in the model input", async () => {
  const received: string[] = [];
  const h = await readingFixture((req, { system, afterTool }) => {
    received.push(...req.messages.map((m) => String(m.content)));
    if (system.includes("You are Delivery") && !afterTool)
      return callTool("consult", "consult_super_agent", { question });
    return say("Use the north dock.");
  });
  try {
    await h.env.client.call("threads.send", { thread: h.thread.id, text: "Check the delivery dock." });
    const cards = () =>
      h.store.messages
        .list(h.thread.id, 50)
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "subthread");
    await waitFor(() => cards().some((p) => p.state === "completed"), "consultation settles");
    const card = cards()[0];
    assert.ok(card);
    assert.equal(card.title, question);
    assert.equal(card.question, question);
    assert.equal(card.agent_id, "superagent");
    const child = h.store.threads.get(card.thread_id);
    assert.equal(child?.parent_id, h.thread.id);
    assert.match(child?.title ?? "", /Delivery → /);
    assert.ok(child?.title.includes(question));
    const sent = h.store.messages
      .list(card.thread_id, 50)
      .find((m) => m.author.kind === "agent" && m.author.id === h.agent.id);
    const text = sent?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n") ?? "";
    assert.equal(text, question, "the actual conversation shows only the question, not private instructions");
    assert.ok(
      received.some((text) => text.includes("<contact_question") && text.includes("only what answers this")),
      "the callee still receives the private instructions through its model input",
    );
    const run = h.store.runs.list(card.thread_id, 5)[0];
    assert.match(run?.input?.text ?? "", /<contact_question/);
    assert.equal(card.title.includes("Your owner allowed"), false);
  } finally {
    await h.close();
  }
});
