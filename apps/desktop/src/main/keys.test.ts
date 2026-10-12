import assert from "node:assert/strict";
import { test } from "node:test";
import { parseKeys, parseWinKeys, REFUSED_KEYS, refusedKeys } from "./keys.ts";

test("keys read as names or characters with their modifiers; quitting is refused", () => {
  assert.deepEqual(parseKeys("enter"), { code: 36, flags: 0 });
  assert.deepEqual(parseKeys("cmd+l"), { code: 37, flags: 0x100000 });
  assert.deepEqual(parseKeys("Command+Shift+T"), { code: 17, flags: 0x120000 });
  assert.deepEqual(parseKeys("alt+down"), { code: 125, flags: 0x80000 });
  assert.equal(parseKeys("hyper+x"), undefined);
  assert.equal(parseKeys("f13"), undefined);
  assert.ok(REFUSED_KEYS.has("cmd+q"));
});

test("on Windows cmd means ctrl, arrows go as extended keys, and closing shortcuts are refused in either name", () => {
  assert.deepEqual(parseWinKeys("cmd+l"), { vk: 0x4c, mods: [0x11], extended: false });
  assert.deepEqual(parseWinKeys("Ctrl+Shift+T"), { vk: 0x54, mods: [0x11, 0x10], extended: false });
  assert.deepEqual(parseWinKeys("alt+down"), { vk: 0x28, mods: [0x12], extended: true });
  assert.deepEqual(parseWinKeys("enter"), { vk: 0x0d, mods: [], extended: false });
  assert.equal(parseWinKeys("win+r"), undefined);
  assert.ok(refusedKeys("cmd+w", "win32"));
  assert.ok(refusedKeys("Ctrl + Q", "win32"));
  assert.ok(refusedKeys("alt+f4", "win32"));
  assert.ok(!refusedKeys("ctrl+l", "win32"));
  assert.ok(refusedKeys("cmd+q", "darwin"));
  assert.ok(!refusedKeys("ctrl+w", "darwin"));
});
