import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEditingKey, handleScrollKey, isExitCommand, isReturnKey } from "../src/interfaces/cli/commands/sys.js";

function makeState() {
  return {
    currentModeIdx: 0,
    inputText: "",
    cursorIndex: 0,
    hasStarted: false,
    chatScrollOffset: 0,
  };
}

test("return key is detected for terminal submit", () => {
  assert.equal(isReturnKey({ name: "return" }), true);
  assert.equal(isReturnKey({ name: "enter" }), true);
  assert.equal(isReturnKey({ name: "backspace" }), false);
});

test("exit command is detected exactly", () => {
  assert.equal(isExitCommand("exit"), true);
  assert.equal(isExitCommand(" quit "), true);
  assert.equal(isExitCommand("exit now"), false);
  assert.equal(isExitCommand(""), false);
});

test("editing ignores return control character", () => {
  const state = makeState();
  let rendered = false;

  const handled = handleEditingKey("\r", { name: "return" }, state, () => {
    rendered = true;
  });

  assert.equal(handled, false);
  assert.equal(rendered, false);
  assert.equal(state.inputText, "");
  assert.equal(state.cursorIndex, 0);
});

test("editing inserts printable characters", () => {
  const state = makeState();

  const handled = handleEditingKey("a", { name: "a" }, state, () => {});

  assert.equal(handled, true);
  assert.equal(state.inputText, "a");
  assert.equal(state.cursorIndex, 1);
});

test("scroll keys move chat transcript offset after chat starts", () => {
  const state = makeState();
  state.hasStarted = true;
  let renders = 0;

  assert.equal(handleScrollKey({ name: "up" }, state, () => { renders++; }), true);
  assert.equal(state.chatScrollOffset, 3);
  assert.equal(handleScrollKey({ name: "pagedown" }, state, () => { renders++; }), true);
  assert.equal(state.chatScrollOffset, 0);
  assert.equal(renders, 2);
});

test("scroll keys are ignored before chat starts", () => {
  const state = makeState();

  assert.equal(handleScrollKey({ name: "up" }, state, () => {}), false);
  assert.equal(state.chatScrollOffset, 0);
});
