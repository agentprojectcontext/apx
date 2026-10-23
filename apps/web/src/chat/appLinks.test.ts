import assert from "node:assert/strict";
import { test } from "node:test";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test", hash: "" }, addEventListener() {} },
});
const { appPlace } = await import("./appLinks.ts");
if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
else Reflect.deleteProperty(globalThis, "window");

const kindOf = (href: string) => {
  const place = appPlace(href);
  if (!place) return undefined;
  const { open: _open, ...rest } = place;
  return rest;
};

test("an app link says what it opens, so its button can show the place's icon and hint", () => {
  assert.deepEqual(kindOf("apx:tasks/task_0123abcd"), { kind: "task", id: "task_0123abcd" });
  assert.deepEqual(kindOf("apx:tasks"), { kind: "tasks" });
  assert.deepEqual(kindOf("apx:settings/desktop"), { kind: "settings", section: "desktop" });
  assert.deepEqual(kindOf("apx:config"), { kind: "settings", section: "account" });
  assert.deepEqual(kindOf("apx:resources/mcp"), { kind: "resources", tab: "mcp" });
  assert.deepEqual(kindOf("apx:inbox"), { kind: "inbox" });
  assert.deepEqual(kindOf("apx:chat/thr_1"), { kind: "chat", id: "thr_1" });
  assert.deepEqual(kindOf("apx:project/prj_1/tasks"), { kind: "project", id: "prj_1" });
});

test("an app link to no known place opens nothing", () => {
  for (const href of ["apx:settings/nowhere", "apx:resources/nope", "apx:chat", "apx:project", "apx:elsewhere"])
    assert.equal(appPlace(href), undefined, href);
});
