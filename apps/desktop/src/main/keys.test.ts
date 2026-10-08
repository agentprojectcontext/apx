import assert from "node:assert/strict";
import { test } from "node:test";
import { parseKeys, REFUSED_KEYS } from "./keys.ts";

test("keys read as names, characters and modifiers; quitting is refused", () => {
  assert.deepEqual(parseKeys("enter"), { kind: "code", key: "36", mods: "" });
  assert.deepEqual(parseKeys("cmd+l"), { kind: "text", key: "l", mods: "cmd" });
  assert.deepEqual(parseKeys("Command+Shift+T"), { kind: "text", key: "t", mods: "cmd shift" });
  assert.deepEqual(parseKeys("alt+down"), { kind: "code", key: "125", mods: "option" });
  assert.equal(parseKeys("hyper+x"), undefined);
  assert.equal(parseKeys("f13"), undefined);
  assert.ok(REFUSED_KEYS.has("cmd+q"));
});
