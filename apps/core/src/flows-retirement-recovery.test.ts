import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { tempDir } from "./testkit/platform.ts";

test("retirement retries the original renamed address after secret storage failure and restart", async (t) => {
  const home = tempDir();
  const projectFolder = tempDir();
  let env = await startCore({ home: home.path, llm: scriptedLlm(() => say("Unused")) });
  try {
    const project = (await env.client.call("projects.register", { path: projectFolder.path, init: true })).project.id;
    const definition = {
      id: "cleanup",
      projectId: project,
      name: "Cleanup",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" as const },
    };
    await env.client.call("flows.set", definition);
    await env.client.call("flows.path_set", { flow: "cleanup", path: "renamed" });
    const credential = await env.client.call("public_routes.rotate", { path: "/flows/renamed" });
    const token = env.core.secrets.resolve(credential.secret_ref);
    await env.client.call("flows.set", { ...definition, enabled: false });
    const originalSet = env.core.secrets.set.bind(env.core.secrets);
    const failure = t.mock.method(env.core.secrets, "set", (name: string, value: string | null) => {
      if (value === null) throw new Error("Secret storage unavailable");
      return originalSet(name, value);
    });
    const send = async () => {
      const { port } = await env.client.call("webhooks.get", {});
      const response = await fetch(`http://127.0.0.1:${port}/flows/renamed`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "{}",
      });
      await response.text();
      return response.status;
    };
    await assert.rejects(
      env.client.call("flows.retire", { flow: "cleanup", confirm: true, exported: true }),
      /credential cleanup failed/,
    );
    assert.equal(env.core.store.flows.get("cleanup"), undefined);
    assert.ok(env.core.secrets.resolve(credential.secret_ref));
    assert.equal(await send(), 404);
    await env.client.call("flows.set", { ...definition, id: "during-cleanup", path: "renamed" });
    const replacementDuringFailure = await env.client.call("public_routes.rotate", { path: "/flows/renamed" });
    failure.mock.restore();
    await env.core.close();
    env = await startCore({ home: home.path, llm: scriptedLlm(() => say("Unused")) });
    assert.equal(await send(), 401);
    assert.equal(
      (await env.client.call("flows.retire", { flow: "cleanup", confirm: true, exported: true })).retired,
      false,
    );
    assert.equal(env.core.secrets.resolve(credential.secret_ref), undefined);
    assert.equal(env.core.store.settings.get("public-route-credentials")?.includes(credential.secret_ref), false);
    assert.equal(await send(), 401);
    await assert.rejects(env.client.call("flows.set", definition), /Invalid Flow/);
    await env.client.call("flows.retire", { flow: "cleanup", confirm: true, exported: true });
    assert.ok(
      env.core.secrets.resolve(replacementDuringFailure.secret_ref),
      "cleanup and completed retries cannot revoke a reused address",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
    await projectFolder.remove();
  }
});
