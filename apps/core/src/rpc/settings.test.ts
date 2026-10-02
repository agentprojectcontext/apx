import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("a stored setting that does not read falls back to its default instead of reaching the app", async () => {
  const { settings } = env.core.store;
  settings.set("desktop", "{not json");
  settings.set("task_columns", "[]");
  settings.set("notices", JSON.stringify({ inputs_after_s: "soon" }));
  assert.deepEqual(await env.client.call("desktop.get", {}), { shortcut: "Alt+Space", launch_at_login: false });
  assert.deepEqual(
    (await env.client.call("tasks.list", {})).columns.map((c) => c.id),
    ["backlog", "todo", "doing", "review"],
  );
  assert.equal((await env.client.call("notices.get", {})).inputs_after_s, 120);
});

test("one bad field of the desktop prefs falls back alone; a saved value reads back", async () => {
  const { settings } = env.core.store;
  settings.set("desktop", JSON.stringify({ shortcut: 42, launch_at_login: true }));
  assert.deepEqual(await env.client.call("desktop.get", {}), { shortcut: "Alt+Space", launch_at_login: true });
  await env.client.call("desktop.set", { shortcut: "Alt+K", launch_at_login: false });
  assert.deepEqual(await env.client.call("desktop.get", {}), { shortcut: "Alt+K", launch_at_login: false });
});

test("a default handed out is a copy: changing it never changes the next read", () => {
  const { settings } = env.core.store;
  settings.set("skills_off", "oops");
  settings.read("skills_off")["*"] = ["brief"];
  assert.deepEqual(settings.read("skills_off"), {});
});
