import { test } from "node:test";
import assert from "node:assert/strict";
import { splitThinking, stripThinking, formatForChannel } from "#core/util/thinking.js";

test("splitThinking — no tags", () => {
  const r = splitThinking("hola");
  assert.equal(r.thinking, "");
  assert.equal(r.answer, "hola");
});

test("splitThinking — single <think> block", () => {
  const r = splitThinking("<think>razono mucho</think>\n\nLa respuesta es 42.");
  assert.equal(r.thinking, "razono mucho");
  assert.equal(r.answer, "La respuesta es 42.");
});

test("splitThinking — <thinking> long form is also accepted", () => {
  const r = splitThinking("<thinking>...</thinking>resp");
  assert.equal(r.thinking, "...");
  assert.equal(r.answer, "resp");
});

test("splitThinking — multiple blocks are concatenated", () => {
  const r = splitThinking("<think>uno</think> entre <think>dos</think>final");
  assert.equal(r.thinking, "uno\n\ndos");
  assert.match(r.answer, /entre.*final/s);
});

test("splitThinking — handles nested-looking text without choking", () => {
  const r = splitThinking("plain <think>nested <foo> tags</think> done");
  assert.equal(r.thinking, "nested <foo> tags");
  assert.match(r.answer, /plain.*done/);
});

test("stripThinking — convenience", () => {
  assert.equal(stripThinking("<think>x</think>y"), "y");
  assert.equal(stripThinking("y"), "y");
  assert.equal(stripThinking(""), "");
  assert.equal(stripThinking(null), "");
});

test("formatForChannel — telegram strips reasoning", () => {
  const t = formatForChannel("<think>ssss</think>respuesta", "telegram");
  assert.equal(t, "respuesta");
});

test("formatForChannel — terminal/cli/log keeps reasoning visible", () => {
  const t = formatForChannel("<think>ssss</think>respuesta", "cli");
  assert.match(t, /<thinking>\nssss\n<\/thinking>/);
  assert.match(t, /respuesta$/);
});

test("formatForChannel — terminal channel without thinking just returns answer", () => {
  assert.equal(formatForChannel("hola", "cli"), "hola");
});
