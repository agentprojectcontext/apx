// The work an agent did is visible unless you turn it off.
//
// The transcript had two layouts — tools folded into collapsible ActionGroups,
// or "pelado": narration only, tool calls hidden — and the default was pelado.
// That is the wrong way round. The answer is the one part of a turn you can
// read afterwards anyway; the work is the part you cannot reconstruct from it.
// Defaulting to hidden meant every new chat, on every new device, opened lying
// by omission about what had just run — a turn that shelled out, wrote a file
// and posted a message rendered as a paragraph claiming it had.
//
// It was also the odd one out. `MessageList` and `MessageBubble` both declare
// `showTools = true`, so the code panel, the Roby bubble and a routine's
// execution transcript always showed them; only the main chat hid them.
//
// Three properties, and all three matter:
//   · visible when nobody has chosen (this file)
//   · per DEVICE — localStorage, never config, so the phone and the desktop
//     disagree freely and neither changes anything for anyone else
//   · per CHAT, keyed identically from the Inbox, a project and the phone, so
//     turning it off in one is turning it off in all three
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// A localStorage that behaves like the real one, so the module can be imported
// and exercised rather than grepped.
function withStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

const prefs = () => import(
  path.join(ROOT, "src/interfaces/web/src/lib/chat-prefs.ts") + `?t=${Math.random()}`
);

test("a chat nobody has set shows its tools", async () => {
  withStorage();
  const { showTools, showToolsDefault } = await prefs();
  assert.equal(showToolsDefault(), true);
  assert.equal(showTools("apx.chat.showTools.1.thread:a2a:coo~super_agent"), true);
});

test("off is a choice, and it sticks to that one chat", async () => {
  const store = withStorage();
  const { showTools, setShowTools, showToolsKey } = await prefs();
  const here = showToolsKey(1, "thread:a2a:coo~super_agent");
  const elsewhere = showToolsKey(1, "conv:rocky:web-main");

  setShowTools(here, false);
  assert.equal(showTools(here), false, "the chat you turned off stays off");
  assert.equal(showTools(elsewhere), true, "…and only that chat");
  assert.equal(store.get(here), "0");
});

test("the header switch moves the device fallback; the group checkbox does not", async () => {
  withStorage();
  const { showToolsDefault, setShowTools, showToolsKey } = await prefs();

  // The create-group checkbox: a choice about that one room.
  setShowTools(showToolsKey(1, "thread:group:g1"), false);
  assert.equal(showToolsDefault(), true, "one room's layout is not a device setting");

  // The header switch: flipping it once should not have to be repeated in every
  // conversation opened next.
  setShowTools(showToolsKey(1, "conv:rocky:web-main"), false, { alsoDefault: true });
  assert.equal(showToolsDefault(), false);
});

test("the preference has ONE home, and it is not a chat screen", () => {
  // It used to live inside ChatTab, which forced the other place that needs the
  // default — the create-group checkbox in ChatList — to hardcode a second copy
  // of it. The two drift the moment the default changes, which is exactly what
  // this change does.
  const tab = read("src/interfaces/web/src/screens/project/ChatTab.tsx");
  const list = read("src/interfaces/web/src/components/chat/ChatList.tsx");
  for (const [name, src] of [["ChatTab", tab], ["ChatList", list]]) {
    assert.doesNotMatch(src, /localStorage\.(get|set)Item\("apx\.chat\.showTools/, `${name} must not touch the key itself`);
    assert.doesNotMatch(src, /"apx\.chat\.showTools/, `${name} must not spell the key at all`);
  }
  assert.match(list, /useState\(showToolsDefault\)/, "the group checkbox reads the shared default");
  assert.match(tab, /from "\.\.\/\.\.\/lib\/chat-prefs"/);
});

test("the same chat is the same key from all three surfaces", () => {
  // /inbox, /m/chat/:pid/... and /p/:pid/chat all mount ChatTab, and the key is
  // built from (pid, chatKeyToString(selection)) — the one stringifier that
  // knows what makes a chat itself. Turning tools off while reading a thread in
  // the Inbox is therefore off when the phone opens the same thread.
  const tab = read("src/interfaces/web/src/screens/project/ChatTab.tsx");
  assert.match(tab, /showToolsKey\(pid, chatKeyToString\(selected\)\)/);
});
