import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a stored setting that does not read falls back to its default instead of reaching the app", async () => {
  const { settings } = env.core.store;
  settings.set("desktop", "{not json");
  settings.set("task_columns", "[]");
  settings.set("notices", JSON.stringify({ inputs_after_s: "soon" }));
  assert.deepEqual(await env.client.call("desktop.get", {}), {
    shortcut: "Alt+Space",
    launch_at_login: true,
    computer_use: false,
  });
  assert.deepEqual(
    (await env.client.call("tasks.list", {})).columns.map((c) => c.id),
    ["backlog", "todo", "doing", "review"],
  );
  assert.equal((await env.client.call("notices.get", {})).inputs_after_s, 120);
});

test("one bad field of the desktop prefs falls back alone; a saved value reads back", async () => {
  const { settings } = env.core.store;
  settings.set("desktop", JSON.stringify({ shortcut: 42, launch_at_login: false }));
  assert.deepEqual(await env.client.call("desktop.get", {}), {
    shortcut: "Alt+Space",
    launch_at_login: false,
    computer_use: false,
  });
  await env.client.call("desktop.set", { shortcut: "Alt+K", launch_at_login: true, computer_use: true });
  assert.deepEqual(await env.client.call("desktop.get", {}), {
    shortcut: "Alt+K",
    launch_at_login: true,
    computer_use: true,
  });
});

test("a list setting drops only the item that does not read, and an unreadable list reads as empty", async () => {
  const { settings } = env.core.store;
  const acme = { id: "acme", transport: "openai-chat", base_url: "http://127.0.0.1:9", key: "none", models: ["m1"] };
  settings.set("providers", JSON.stringify([acme, { ...acme, id: "Not An Id" }, { id: "northwind" }]));
  const ids = (await env.client.call("providers.list", {})).providers.map((p) => p.id);
  assert.ok(ids.includes("acme"));
  assert.ok(!ids.includes("Not An Id") && !ids.includes("northwind"));
  settings.set("channels", "{not json");
  assert.deepEqual((await env.client.call("channels.list", {})).channels, []);
});

test("a default handed out is a copy: changing it never changes the next read", () => {
  const { settings } = env.core.store;
  settings.set("skills_off", "oops");
  settings.read("skills_off")["*"] = ["brief"];
  assert.deepEqual(settings.read("skills_off"), {});
});

test("provider key replacement exposes only a suffix and preserves the replacement on edits", async () => {
  const provider = { label: "Acme", transport: "openai-chat" as const, base_url: "http://127.0.0.1:9", models: ["m1"] };
  const first = "example-private-key-1234";
  const second = "example-private-key-5678";
  const created = await env.client.call("providers.set", { id: "acme-key", provider, api_key: first });
  assert.equal(created.providers.find((p) => p.id === "acme-key")?.key_hint, "1234");
  assert.ok(!JSON.stringify(created).includes(first));
  const changed = await env.client.call("providers.set", { id: "acme-key", provider, api_key: second });
  assert.equal(changed.providers.find((p) => p.id === "acme-key")?.key_hint, "5678");
  const kept = await env.client.call("providers.set", { id: "acme-key", provider: { ...provider, enabled: false } });
  assert.equal(kept.providers.find((p) => p.id === "acme-key")?.key_hint, "5678");
  assert.ok(!JSON.stringify(kept).includes(second));
  const short = await env.client.call("providers.set", { id: "acme-key", provider, api_key: "short" });
  assert.equal(short.providers.find((p) => p.id === "acme-key")?.key_hint, undefined);
  await env.client.call("providers.set", { id: "acme-key", provider: null });
});

test("replacing a provider's environment key switches to the saved credential", async () => {
  const provider = {
    label: "Northwind",
    transport: "openai-chat" as const,
    base_url: "http://127.0.0.1:9",
    models: ["m1"],
  };
  env.core.store.settings.write("providers", [{ ...provider, id: "northwind-key", key: "env:APX_TEST_MISSING_KEY" }]);
  const result = await env.client.call("providers.set", {
    id: "northwind-key",
    provider,
    api_key: "example-replacement-key-9012",
  });
  assert.equal(result.providers.find((p) => p.id === "northwind-key")?.key_hint, "9012");
  assert.equal(
    env.core.store.settings.read("providers").find((p) => p.id === "northwind-key")?.key,
    "secret://northwind-key",
  );
});
