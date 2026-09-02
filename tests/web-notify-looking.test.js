// Notifications must not fire for the thread already on screen.
//
// The inbox writes `?channel=&thread=` (groups have no `?agent=`), and matching
// only the agent slug let a group reply you were watching also ring the bell.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { urlLooksAt } = await import(
  path.join(ROOT, "src/interfaces/web/src/screens/mobile/routes.ts")
);

function row(over = {}) {
  return {
    project_id: 1,
    project_name: "acme",
    project_path: "/path/to/project",
    agent_slug: "april",
    agent_name: "April",
    agent_emoji: null,
    agent_icon: null,
    kind: "agent",
    pinned: false,
    conversation_id: "conv-1",
    channel: "web",
    messages: 1,
    preview: "hello",
    last_activity_at: "2026-08-25T22:00:00.000Z",
    ...over,
  };
}

const group = row({
  agent_slug: "group:grp-mt8znlpd-hx36",
  agent_name: "April",
  kind: "group",
  conversation_id: "grp-mt8znlpd-hx36",
  channel: "group",
});

test("the inbox group URL counts as looking at that group, not at another row", () => {
  const href = "http://localhost:7430/inbox?channel=group&thread=grp-mt8znlpd-hx36";
  assert.equal(urlLooksAt(href, group), true);
  assert.equal(urlLooksAt(href, row({ kind: "group", conversation_id: "grp-other", agent_slug: "group:grp-other", channel: "group" })), false);
  assert.equal(urlLooksAt(href, row()), false);
});

test("a project chat group URL is the same shape as the inbox", () => {
  assert.equal(
    urlLooksAt("http://localhost:7430/p/1/chat?channel=group&thread=grp-mt8znlpd-hx36", group),
    true,
  );
});

test("an inbox with no session in the URL is not looking at any row", () => {
  assert.equal(urlLooksAt("http://localhost:7430/inbox", group), false);
  assert.equal(urlLooksAt("http://localhost:7430/inbox", row()), false);
});

test("a desktop agent query still counts as looking at that agent", () => {
  const href = "http://localhost:7430/p/1/chat?agent=april&conv=conv-1";
  assert.equal(urlLooksAt(href, row()), true);
  assert.equal(urlLooksAt(href, group), false);
  assert.equal(urlLooksAt("http://localhost:7430/p/1/chat?agent=magui", row()), false);
});

test("the phone path still counts as looking at that agent", () => {
  assert.equal(urlLooksAt("http://localhost:7430/m/chat/1/april", row()), true);
  assert.equal(urlLooksAt("http://localhost:7430/m/chat/1/april/conv-1", row()), true);
  assert.equal(urlLooksAt("http://localhost:7430/m/chat/1/magui", row()), false);
  assert.equal(
    urlLooksAt("http://localhost:7430/m/chat/1/group%3Agrp-mt8znlpd-hx36/group~grp-mt8znlpd-hx36", group),
    true,
  );
});

// The phone's old address. A notification raised before the rename still
// carries it, and a tab that has not been redirected yet is still the thread
// you are reading — answering "no" there rings the bell for what is on screen.
test("the pre-rename phone path still counts as looking", () => {
  assert.equal(urlLooksAt("http://localhost:7430/mobile/chat/1/april", row()), true);
  assert.equal(urlLooksAt("http://localhost:7430/mobile/chat/1/april/conv-1", row()), true);
  assert.equal(urlLooksAt("http://localhost:7430/mobile/chat/1/magui", row()), false);
});
