import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { tempDir } from "./testkit/platform.ts";

test("a failed retirement journal rolls back deletion and leaves the disabled Flow recoverable", async (t) => {
  const projectFolder = tempDir();
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const project = (await env.client.call("projects.register", { path: projectFolder.path, init: true })).project.id;
    await env.client.call("flows.set", {
      id: "atomic",
      projectId: project,
      path: "atomic-address",
      name: "Atomic",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    const credential = await env.client.call("flows.token_rotate", { flow: "atomic" });
    assert.ok(credential.token);
    await env.client.call("flows.write", { flow: "atomic", key: "retained", value: { keep: true } });
    const set = env.core.store.settings.set.bind(env.core.store.settings);
    const failure = t.mock.method(env.core.store.settings, "set", (key: string, value: string) => {
      if (key === "public-route-credential-cleanup") throw new Error("Journal unavailable");
      return set(key, value);
    });
    await assert.rejects(env.client.call("flows.retire", { flow: "atomic", confirm: true, exported: true }));
    assert.equal(env.core.store.flows.get("atomic")?.enabled, false);
    assert.equal(env.core.store.flows.rows("atomic", 10)[0]?.key, "retained");
    failure.mock.restore();
    assert.equal(
      (await env.client.call("flows.retire", { flow: "atomic", confirm: true, exported: true })).retired,
      true,
    );
    assert.equal(env.core.store.settings.get("public-route-credentials")?.includes("/flows/atomic-address"), false);
    assert.deepEqual(JSON.parse(env.core.store.settings.get("public-route-credential-cleanup") ?? "null"), []);
  } finally {
    await env.core.close();
    await env.cleanup();
    await projectFolder.remove();
  }
});

test("a full credential cleanup journal refuses retirement with its own reason and keeps the Flow", async () => {
  const projectFolder = tempDir();
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const project = (await env.client.call("projects.register", { path: projectFolder.path, init: true })).project.id;
    await env.client.call("flows.set", {
      id: "crowded",
      projectId: project,
      name: "Crowded",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    await env.client.call("flows.token_rotate", { flow: "crowded" });
    const queued = Array.from({ length: 1000 }, (_, i) => `secret://public-token-${i.toString(16).padStart(32, "0")}`);
    env.core.store.settings.set("public-route-credential-cleanup", JSON.stringify(queued));
    await assert.rejects(
      env.client.call("flows.retire", { flow: "crowded", confirm: true, exported: true }),
      /cleanup is full/,
    );
    assert.equal(env.core.store.flows.get("crowded")?.enabled, false);
    assert.equal(env.core.store.settings.get("public-route-credentials")?.includes("/flows/crowded"), true);
  } finally {
    await env.core.close();
    await env.cleanup();
    await projectFolder.remove();
  }
});
