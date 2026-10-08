import assert from "node:assert/strict";
import { test } from "node:test";
import { parseKeys, REFUSED_KEYS } from "./keys.ts";

test("keys read as names or characters with their modifiers; quitting is refused", () => {
  assert.deepEqual(parseKeys("enter"), { code: 36, flags: 0 });
  assert.deepEqual(parseKeys("cmd+l"), { code: 37, flags: 0x100000 });
  assert.deepEqual(parseKeys("Command+Shift+T"), { code: 17, flags: 0x120000 });
  assert.deepEqual(parseKeys("alt+down"), { code: 125, flags: 0x80000 });
  assert.equal(parseKeys("hyper+x"), undefined);
  assert.equal(parseKeys("f13"), undefined);
  assert.ok(REFUSED_KEYS.has("cmd+q"));
});
