import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ArtifactBundle } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { kitVersionOf } from "./surfaces.ts";

const PAGE = `<meta name="apx-live" content="15m"><script src="/_apx/kit@1.2.js"></script><h1>Orders</h1>`;

test("a page names the kit version it loads", () => {
  assert.equal(kitVersionOf(PAGE), "1.2");
  assert.equal(kitVersionOf("<h1>plain</h1>"), undefined);
});

test("an artifact's store and database work through the protocol, export without and with memory, and import back", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-artifact-rpc-"));
  try {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Northwind\n");
    const { project } = await env.client.call("projects.register", { path: root });
    const s = await env.client.call("surfaces.show", {
      name: "orders",
      title: "Orders",
      html: PAGE,
      app: true,
      connect: ["https://api.example.com"],
    });
    await env.client.call("surfaces.set_state", { surface: s.id, patch: { tab: "open" } });
    assert.deepEqual(await env.client.call("surfaces.store_set", { surface: s.id, patch: { last: [1, 2] } }), {
      keys: 1,
      bytes: 9,
    });
    assert.deepEqual((await env.client.call("surfaces.store_get", { surface: s.id })).values, { last: [1, 2] });
    await env.client.call("surfaces.db_exec", {
      surface: s.id,
      sql: "CREATE TABLE orders (item TEXT)",
    });
    const ins = await env.client.call("surfaces.db_exec", {
      surface: s.id,
      sql: "INSERT INTO orders VALUES (?)",
      params: ["tea"],
    });
    assert.equal(ins.changes, 1);
    await assert.rejects(
      env.client.call("surfaces.db_exec", { surface: s.id, sql: "ATTACH DATABASE 'x.sqlite' AS x" }),
      /not authorized/,
    );
    const mem = await env.client.call("surfaces.memory", { surface: s.id });
    assert.equal(mem.state_chars, JSON.stringify({ tab: "open" }).length);
    assert.deepEqual(mem.store.keys, ["last"]);
    assert.deepEqual(mem.db.tables, [{ name: "orders", rows: 1 }]);
    assert.ok(fs.existsSync(path.join(env.home, "artifacts", "global", "orders", "data.sqlite")));

    // Without memory (the default) a bundle carries the page and its manifest only.
    await env.client.call("secrets.set", { name: "artifact.orders.api", value: "tok_never_exported_1" });
    const bare = await env.client.call("surfaces.export", { surface: s.id });
    assert.equal(ArtifactBundle.safeParse(bare).success, true);
    const { exported_at, ...shape } = bare.manifest;
    assert.ok(exported_at);
    assert.deepEqual(shape, {
      name: "orders",
      title: "Orders",
      kind: "app",
      version: 1,
      kit: "1.2",
      connect: ["https://api.example.com"],
      secrets: ["api"],
      live: true,
    });
    assert.equal(bare.state, undefined);
    assert.equal(bare.store, undefined);
    assert.equal(bare.db, undefined);
    assert.ok(!JSON.stringify(bare).includes("tok_never_exported_1"));

    const full = await env.client.call("surfaces.export", { surface: s.id, memory: true });
    assert.deepEqual(full.state, { tab: "open" });
    assert.deepEqual(full.store, { last: [1, 2] });
    assert.ok(full.db && Buffer.from(full.db, "base64").subarray(0, 15).toString() === "SQLite format 3");

    // Imported into a project and again globally, where "orders" is taken.
    const inProject = await env.client.call("surfaces.import", { bundle: full, project: project.id });
    assert.equal(inProject.name, "orders");
    assert.equal(inProject.project_id, project.id);
    assert.equal(inProject.app, true);
    assert.deepEqual(inProject.connect, ["https://api.example.com"]);
    assert.deepEqual((await env.client.call("surfaces.get", { surface: inProject.id })).state, { tab: "open" });
    assert.deepEqual((await env.client.call("surfaces.store_get", { surface: inProject.id })).values, { last: [1, 2] });
    const rows = await env.client.call("surfaces.db_query", { surface: inProject.id, sql: "SELECT item FROM orders" });
    assert.deepEqual(rows, { columns: ["item"], rows: [["tea"]] });
    const again = await env.client.call("surfaces.import", { bundle: bare });
    assert.equal(again.name, "orders-2");
    assert.deepEqual((await env.client.call("surfaces.memory", { surface: again.id })).db.tables, []);

    // Clearing forgets the parts asked for.
    const cleared = await env.client.call("surfaces.memory_clear", { surface: s.id, parts: ["state", "store"] });
    assert.equal(cleared.state_chars, 0);
    assert.deepEqual(cleared.store.keys, []);
    assert.deepEqual(cleared.db.tables, [{ name: "orders", rows: 1 }]);
    assert.deepEqual(cleared.secrets, []);
    assert.deepEqual(
      (await env.client.call("surfaces.memory_clear", { surface: s.id, parts: ["secrets"] })).secrets,
      [],
    );

    // Fetch: only its origins, only its own secrets.
    await assert.rejects(
      env.client.call("surfaces.fetch", { surface: s.id, url: "https://evil.example.com/" }),
      /not among the origins/,
    );
    await assert.rejects(
      env.client.call("surfaces.fetch", {
        surface: s.id,
        url: "https://api.example.com/",
        secret: { name: "artifact.other.api", in: "bearer" },
      }),
      /not one of this artifact's secrets/,
    );
  } finally {
    await env.core.close();
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an artifact's file says who made it, and an installed one keeps its maker when exported again", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-artifact-origin-"));
  try {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Northwind\n");
    const { project } = await env.client.call("projects.register", { path: root });
    await env.client.call("owner.set", { name: "Ada" });
    const chat = await env.client.call("threads.create", { kind: "agent", agent_id: "roby", project_id: project.id });
    // Made by an agent in its chat (a call from an agent's turn sets created_by; here the store does it directly).
    const s = env.core.store.surfaces.upsert({
      name: "orders",
      title: "Orders",
      html: PAGE,
      project_id: project.id,
      thread_id: chat.id,
      created_by: "roby",
    });
    const bundle = await env.client.call("surfaces.export", { surface: s.id });
    assert.equal(bundle.manifest.author, "Ada");
    assert.equal(bundle.manifest.agent, env.core.store.agents.get("roby")?.name);
    const projectName = env.core.store.projects.get(project.id)?.name;
    assert.equal(bundle.manifest.project, projectName);
    assert.ok(bundle.manifest.exported_at);

    // Installed elsewhere it keeps where it came from, and a later export still names its first maker.
    const installed = await env.client.call("surfaces.import", { bundle });
    assert.equal(installed.origin?.author, "Ada");
    assert.equal(installed.origin?.project, projectName);
    assert.equal(installed.origin?.version, bundle.manifest.version);
    assert.ok(installed.origin?.installed_at);
    await env.client.call("owner.set", { name: "Grace" });
    const again = await env.client.call("surfaces.export", { surface: installed.id });
    assert.equal(again.manifest.author, "Ada");
  } finally {
    await env.core.close();
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
