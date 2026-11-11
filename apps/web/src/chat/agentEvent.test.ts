import assert from "node:assert/strict";
import { test } from "node:test";
import { Message, Thread } from "@apx/protocol";
import { answerCards, isAgentEvent, responseOf } from "./agentEvent.ts";

const thread = Thread.parse({
  id: "chat",
  kind: "loose",
  title: "Chat",
  agent_ids: ["holder"],
  state: "idle",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});
const message = Message.parse({
  id: "msg",
  thread_id: thread.id,
  seq: 1,
  author: { kind: "agent", id: "helper" },
  parts: [{ type: "text", text: "The report." }],
  created_at: "2026-01-01",
});
const response = {
  thread_id: "consult",
  run_id: "run",
  task_id: "task",
  title: "Review the change",
  state: "completed" as const,
};

test("foreign signatures in individual chats are events without invented response provenance", () => {
  assert.equal(isAgentEvent(thread, message), true);
  assert.equal(responseOf(message), undefined);
  assert.equal(isAgentEvent(thread, { ...message, author: { kind: "agent", id: "holder" } }), false);
  assert.equal(isAgentEvent(thread, { ...message, author: { kind: "user" } }), false);
  assert.equal(isAgentEvent({ ...thread, agent_ids: ["holder", "helper"] }, message), true);
});

test("structured response metadata survives serialization and identifies even a same-agent consult", () => {
  const reply = Message.parse(
    JSON.parse(
      JSON.stringify({
        ...message,
        author: { kind: "agent", id: "holder" },
        parts: [{ type: "text", text: "The report.", response }],
      }),
    ),
  );
  assert.deepEqual(responseOf(reply), response);
  assert.equal(isAgentEvent(thread, reply), true);
});

test("real groups, delegated transcripts and task conversations keep their participants", () => {
  for (const kind of ["group", "a2a", "task", "channel", "routine"] as const) {
    assert.equal(isAgentEvent({ ...thread, kind }, message), false);
    assert.equal(
      isAgentEvent({ ...thread, kind }, { ...message, parts: [{ type: "text", text: "Report", response }] }),
      false,
    );
  }
});

test("a subthread card is already an event and is not wrapped twice", () => {
  assert.equal(
    isAgentEvent(thread, {
      ...message,
      parts: [
        {
          type: "subthread",
          thread_id: "consult",
          agent_id: "helper",
          title: "Review",
          state: "completed",
          summary: "The report.",
        },
      ],
    }),
    false,
  );
});

test("a teammate's answer points at its card when the chat shows it, and is told there once", () => {
  const card = (id: string, consult: string) =>
    Message.parse({
      ...message,
      id,
      parts: [{ type: "subthread", thread_id: consult, agent_id: "helper", title: "Q", state: "completed" }],
    });
  const answer = (id: string, consult: string) =>
    Message.parse({
      ...message,
      id,
      parts: [{ type: "text", text: "A", response: { ...response, thread_id: consult } }],
    });
  const said = Message.parse({ ...message, id: "said", author: { kind: "agent", id: "holder" } });
  const cards = answerCards([
    card("c1", "consult"),
    answer("a1", "consult"),
    said,
    // Asked again in the same consult: the latest card is the one answered.
    card("c2", "consult"),
    said,
    answer("a2", "consult"),
    // Asked from elsewhere: no card here, the answer is its own card.
    answer("a3", "other"),
  ]);
  assert.deepEqual(cards.get("a1"), { card: "c1", next: true });
  assert.deepEqual(cards.get("a2"), { card: "c2", next: false });
  assert.equal(cards.get("a3"), undefined);
});
