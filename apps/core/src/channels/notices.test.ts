import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import { inputPresentation, parseButton } from "./notices.ts";

const labels = {
  approve: "Allow",
  deny: "No",
  send: "Send",
  skip: "Skip",
  cut: (more: number) => `(cut: ${more} more characters)`,
};
const confirm = (detail: string): Extract<Part, { type: "input" }> => ({
  type: "input",
  input_id: "in_1",
  kind: "confirm",
  prompt: "Clerk wants to send a message. Allow it?",
  tool: "send_message",
  detail,
  state: "pending",
});

test("a confirmation that fits goes whole, with its buttons", () => {
  const p = inputPresentation(confirm("to: Acme\ntext: hello"), labels);
  assert.equal(p.text, "Clerk wants to send a message. Allow it?\nsend_message: to: Acme\ntext: hello");
  assert.deepEqual(
    p.buttons?.map((b) => b.label),
    ["Allow", "No"],
  );
});

test("a long confirmation keeps the question whole and says how much of the detail was cut", () => {
  const detail = `text: ${"x".repeat(5000)}END`;
  const p = inputPresentation(confirm(detail), labels);
  assert.ok(p.text.length <= 3500, `${p.text.length} chars`);
  assert.ok(p.text.startsWith("Clerk wants to send a message. Allow it?\nsend_message: text: xxx"));
  assert.doesNotMatch(p.text, /END/);
  const more = Number(/… \(cut: (\d+) more characters\)$/.exec(p.text)?.[1]);
  const whole = `Clerk wants to send a message. Allow it?\nsend_message: ${detail}`;
  assert.equal(p.text.length - `… (cut: ${more} more characters)`.length + more, whole.length);
});

test("a multi-choice question ticks its options, then sends them; any question can be skipped", () => {
  const q = {
    input_id: "in_2",
    kind: "question" as const,
    prompt: "Which days?",
    options: ["Mon", "Tue"],
    multi: true,
  };
  const p = inputPresentation(q, labels, new Set([1]));
  assert.deepEqual(p.buttons, [
    { id: "i:in_2:t0", label: "☐ Mon" },
    { id: "i:in_2:t1", label: "☑ Tue" },
    { id: "i:in_2:c", label: "Send" },
    { id: "i:in_2:s", label: "Skip" },
  ]);
  assert.deepEqual(parseButton("i:in_2:t1"), { kind: "toggle", inputId: "in_2", index: 1 });
  assert.deepEqual(parseButton("i:in_2:c"), { kind: "confirm", inputId: "in_2" });
  assert.deepEqual(parseButton("i:in_2:s"), { kind: "skip", inputId: "in_2" });
  const single = inputPresentation({ ...q, multi: false }, labels);
  assert.deepEqual(
    single.buttons?.map((b) => b.id),
    ["i:in_2:o0", "i:in_2:o1", "i:in_2:s"],
  );
});
