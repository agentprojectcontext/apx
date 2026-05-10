import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEditingKey, isReturnKey } from "../src/cli/commands/sys.js";

function makeState() {
  return {
    currentModeIdx: 0,
    inputText: "",
    cursorIndex: 0,
  };
}

test("return key is detected for terminal submit", () => {
  assert.equal(isReturnKey({ name: "return" }), true);
  assert.equal(isReturnKey({ name: "enter" }), true);
  assert.equal(isReturnKey({ name: "backspace" }), false);
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
