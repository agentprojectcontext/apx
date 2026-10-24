import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { methods } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createAsana } from "../integrations/asana.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { asanaTools } from "../tools/asana.ts";

const TOKEN = "example-asana-pat";
test("native Asana lifecycle, pagination, writes and idempotency through the running core", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    asanaFetch: async (input, init) => {
      if (new Headers(init?.headers).get("authorization") === "Bearer invalid")
        return new Response("denied", { status: 401 });
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        ...(init?.body ? { body: String(init.body) } : {}),
      });
      return Response.json({ data: [{ gid: "123", name: "Acme" }], next_page: { offset: "next" } });
    },
  });
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-asana-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  try {
    const project = (await env.client.call("projects.register", { path: repo })).project.id;
    const entry = async () =>
      (await env.client.call("integrations.list", {})).integrations.find((i) => i.id === "asana");
    assert.equal((await entry())?.coming, false);
    await assert.rejects(env.client.call("integrations.connect", { id: "asana", values: {} }));
    await env.client.call("integrations.connect", { id: "asana", values: { token: TOKEN } });
    assert.equal(env.core.secrets.resolve("secret://asana-token"), TOKEN);
    assert.equal((await entry())?.connected, true);
    await assert.rejects(
      env.client.call("integrations.connect", { id: "asana", values: { token: "invalid" } }),
      /HTTP 401/,
    );
    assert.equal(env.core.secrets.resolve("secret://asana-token"), TOKEN);
    await env.client.call("asana.read", { project, request: { operation: "workspaces" } });
    assert.ok(calls.at(-1)?.url.includes("/workspaces?"));
    await env.client.call("asana.read", { project, request: { operation: "projects", workspace: "456", limit: 1 } });
    assert.ok(calls.at(-1)?.url.includes("workspace=456"));
    await env.client.call("asana.read", { project, request: { operation: "task", task: "123" } });
    assert.ok(calls.at(-1)?.url.endsWith("/tasks/123"));
    assert.ok(!JSON.stringify(await entry()).includes(TOKEN));
    assert.ok(!(await env.client.call("mcp.list", {})).servers.some((s) => s.name === "asana"));
    const result = await env.client.call("asana.read", {
      project,
      request: { operation: "tasks", project: "123", offset: "previous" },
    });
    assert.equal(result.next_offset, "next");
    assert.ok(calls.at(-1)?.url.includes("offset=previous"));
    const query = new URL(calls.at(-1)?.url ?? "").searchParams;
    assert.equal(query.get("completed_since"), "now");
    assert.ok(
      query.get("opt_fields")?.includes("notes,permalink_url,memberships.section.name,memberships.section.gid"),
    );
    await env.client.call("asana.read", { project, request: { operation: "tasks", project: "123", completed: true } });
    assert.equal(new URL(calls.at(-1)?.url ?? "").searchParams.has("completed_since"), false);
    await env.client.call("mcp.toggle", { project, server: "asana", on: false });
    assert.deepEqual((await entry())?.off_in, [project]);
    const count = calls.length;
    await assert.rejects(env.client.call("asana.read", { project, request: { operation: "workspaces" } }));
    assert.equal(calls.length, count);
    await env.client.call("mcp.toggle", { project, server: "asana", on: true });
    const request = { project, request: { operation: "create_task", project: "123", name: "Acme task" } };
    const send = () =>
      fetch(`${env.core.url}/rpc/asana.write`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "asana-create-once" },
        body: JSON.stringify(request),
      });
    const first = await send();
    assert.equal(first.status, 200);
    assert.equal((await send()).status, 200);
    assert.equal(calls.filter((c) => c.method === "POST").length, 1);
    assert.deepEqual(JSON.parse(calls.find((c) => c.method === "POST")?.body ?? "{}"), {
      data: { name: "Acme task", projects: ["123"] },
    });
    await env.client.call("asana.write", {
      project,
      request: { operation: "create_task", workspace: "456", name: "Workspace task" },
    });
    assert.deepEqual(JSON.parse(calls.at(-1)?.body ?? "{}"), { data: { workspace: "456", name: "Workspace task" } });
    await env.client.call("asana.write", {
      project,
      request: { operation: "update_task", task: "123", completed: true, due_on: null },
    });
    assert.equal(calls.at(-1)?.method, "PUT");
    await env.client.call("integrations.connect", { id: "asana", values: {} });
    assert.equal(env.core.secrets.resolve("secret://asana-token"), TOKEN);
    await env.client.call("integrations.disconnect", { id: "asana" });
    assert.equal((await entry())?.connected, false);
    assert.ok(!env.core.secrets.has("secret://asana-token"));
    await assert.rejects(env.client.call("asana.read", { request: { operation: "workspaces" } }));
  } finally {
    await env.core.close();
    await env.cleanup();
    await removeDir(repo);
  }
});

test("Asana tools are conditional, writes require owner authority and request schemas reject unsafe ids", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const asana = createAsana({ secrets: env.core.secrets, offIn: (p) => p === "off" });
    const tools = asanaTools(asana, env.core.store);
    assert.equal(tools[1]?.confirm({}), "always");
    assert.equal(
      methods["asana.write"].params.safeParse({ request: { operation: "create_task", name: "No destination" } })
        .success,
      false,
    );
    assert.equal(
      methods["asana.write"].params.safeParse({
        request: { operation: "create_task", workspace: "../unsafe", name: "Unsafe" },
      }).success,
      false,
    );
    assert.equal(methods["asana.write"].access, "human");
    assert.equal(methods["asana.write"].effect, true);
    assert.equal(asana.usable(), false);
    env.core.secrets.set("asana-token", TOKEN);
    assert.equal(asana.usable("off"), false);
    assert.equal(asana.usable("on"), true);
    // Not offered in a chat an outside app started, which the handler refuses.
    const mine = env.core.store.threads.create({ kind: "loose", title: "t", agent_ids: ["roby"] });
    const theirs = env.core.store.threads.create({ kind: "loose", title: "t", agent_ids: ["roby"] });
    env.core.store.threads.mergeContext(theirs.id, { client: "external" });
    assert.equal(tools[0]?.when?.(mine), true);
    assert.equal(tools[0]?.when?.(theirs), false);
    assert.equal(
      methods["asana.read"].params.safeParse({ request: { operation: "task", task: "../users" } }).success,
      false,
    );
    assert.equal(
      methods["asana.write"].params.safeParse({ request: { operation: "create_task", project: "123", name: "" } })
        .success,
      false,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("Asana errors never expose a remote error body and writes are not retried", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    env.core.secrets.set("asana-token", TOKEN);
    let calls = 0;
    const asana = createAsana({
      secrets: env.core.secrets,
      offIn: () => false,
      fetch: async () => {
        calls++;
        return new Response(TOKEN, { status: 429 });
      },
    });
    await assert.rejects(
      asana.write({ operation: "create_task", project: "123", name: "Acme" }),
      /^Error: Asana: HTTP 429$/,
    );
    assert.equal(calls, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
