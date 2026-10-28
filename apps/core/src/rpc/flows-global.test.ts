import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

test("global Flow listing keeps project filters, fixed project ownership and human authorization over HTTP and WS", async () => {
  const a = tempDir();
  const b = tempDir();
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm });
  try {
    const first = (await env.client.call("projects.register", { path: a.path, init: true })).project.id;
    const second = (await env.client.call("projects.register", { path: b.path, init: true })).project.id;
    const draft = (id: string, projectId: string) => ({
      id,
      projectId,
      name: id,
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" as const },
    });
    await env.client.call("flows.set", draft("northwind", first));
    await env.client.call("flows.set", draft("acme", second));
    assert.deepEqual(
      (await env.client.call("flows.list", {})).flows.map((f) => f.id),
      ["acme", "northwind"],
    );
    assert.deepEqual(
      (await env.client.call("flows.list", { project: first })).flows.map((f) => f.id),
      ["northwind"],
    );
    assert.deepEqual(
      (await env.client.call("flows.list", { project: second })).flows.map((f) => f.id),
      ["acme"],
    );
    assert.deepEqual((await env.client.call("flows.list", { project: "missing" })).flows, []);
    const socket = await env.client.connect();
    try {
      assert.equal((await socket.call("flows.list", {})).flows.length, 2);
    } finally {
      socket.close();
      await socket.closed;
    }
    await assert.rejects(env.client.call("flows.set", draft("northwind", second)), /another project/);
    assert.equal(env.core.store.flows.get("northwind")?.projectId, first);
    const external = await env.client.call("clients.create", { name: "Acme", scopes: ["chat"] });
    const outsider = new ApxClient({ url: env.core.url, clientToken: external.token });
    await assert.rejects(outsider.call("flows.list", {}), /outside/);
    await assert.rejects(outsider.call("flows.list", { project: first }), /outside/);
    assert.equal(llm.calls.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
    await a.remove();
    await b.remove();
  }
});
