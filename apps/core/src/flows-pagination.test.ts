import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { tempDir } from "./testkit/platform.ts";

test("private HTTP and WS page every row and failed event before explicit exported retirement", async () => {
  const dir = tempDir();
  const llm = scriptedLlm(() => say("Unexpected model call"));
  const env = await startCore({ llm });
  const socket = await env.client.connect();
  try {
    const projectId = (await env.client.call("projects.register", { path: dir.path, init: true })).project.id;
    const definition = {
      id: "paged",
      projectId,
      name: "Paged",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "agent" as const, agent: "roby", prompt: "Process event" },
    };
    env.core.store.flows.save(definition);
    for (let n = 0; n < 205; n++) {
      const id = `event-${String(n).padStart(3, "0")}`;
      env.core.store.flows.receive("paged", id, { n });
      env.core.store.flows.fail("paged", id);
    }
    for (let n = 0; n < 204; n++) env.core.store.flows.write("paged", `row-${String(n).padStart(3, "0")}`, { n });
    // Freeze the data before exporting; keyset pages are not a cross-request snapshot of a live Flow.
    env.core.store.flows.save({ ...definition, enabled: false });
    const keys: string[] = [];
    let rowCursor: string | undefined;
    do {
      const page = await env.client.call("flows.rows", {
        flow: "paged",
        limit: 100,
        ...(rowCursor ? { cursor: rowCursor } : {}),
      });
      keys.push(...page.rows.map((r) => r.key));
      assert.ok("nextCursor" in page, "pagination must explicitly distinguish a final page");
      rowCursor = page.nextCursor ?? undefined;
    } while (rowCursor);
    assert.equal(keys.length, 205);
    assert.equal(new Set(keys).size, 205);
    assert.equal(keys.at(-1), "row-203");
    const ids: string[] = [];
    let eventCursor: { createdAt: string; eventId: string } | undefined;
    do {
      const page = await socket.call("flows.events", {
        flow: "paged",
        limit: 100,
        ...(eventCursor ? { cursor: eventCursor } : {}),
      });
      assert.ok("nextCursor" in page);
      assert.ok(page.events.every((e) => e.state === "failed"));
      ids.push(...page.events.map((e) => e.event_id));
      eventCursor = page.nextCursor ?? undefined;
    } while (eventCursor);
    assert.equal(ids.length, 205);
    assert.equal(new Set(ids).size, 205);
    assert.ok(ids.includes("event-000"), "old failed events remain discoverable for retry");
    await assert.rejects(env.client.call("flows.retire", { flow: "paged", confirm: true } as never));
    await assert.rejects(env.client.call("flows.retire", { flow: "paged", confirm: true, exported: false } as never));
    assert.equal(env.core.store.flows.rows("paged", 1000).length, 205, "no export acknowledgement means no deletion");
    assert.equal(
      (await env.client.call("flows.retire", { flow: "paged", confirm: true, exported: true })).retired,
      true,
    );
    assert.equal(llm.calls.length, 0);
  } finally {
    socket.close();
    await env.core.close();
    await env.cleanup();
    await dir.remove();
  }
});
