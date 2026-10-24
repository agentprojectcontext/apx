// The owner can delete a widget for good: it leaves every list with what it remembered, and the chats keep their words.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { artifactDir } from "../domain/artifact-memory.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a deleted widget is gone, with its memory, and a second delete says it is not there", async () => {
  const store = env.core.store;
  const s = store.surfaces.upsert({ name: "sales-board", title: "Sales board", html: "<p>hi</p>", created_by: "roby" });
  await env.client.call("surfaces.store_set", { surface: s.id, patch: { count: 3 } });
  const dir = artifactDir(env.home, { name: s.name, project_id: s.project_id });
  assert.ok(fs.existsSync(dir), "it remembered something");
  assert.deepEqual(await env.client.call("surfaces.remove", { surface: s.id }), { removed: true });
  assert.equal(store.surfaces.get(s.id), undefined);
  assert.ok(!(await env.client.call("surfaces.list", {})).surfaces.some((x) => x.id === s.id));
  assert.equal(fs.existsSync(dir), false, "what it remembered went with it");
  await assert.rejects(env.client.call("surfaces.remove", { surface: s.id }), /not found|surface/);
});
