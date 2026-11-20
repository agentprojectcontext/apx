import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { MethodName, Params, Result } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { contactTools } from "./contact.ts";
import type { ToolContext } from "./types.ts";

const changes = [
  "notes revoked",
  "memory disabled",
  "contact reassigned",
  "agent moved",
  "chat moved",
  "migration pending",
  "note edited",
  "note forgotten",
  "note pending",
] as const;
for (const change of changes) {
  test(`a notes lookup held in flight excludes stale data when ${change}`, { timeout: 15_000 }, async () => {
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    const reached = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    try {
      const { project } = await env.client.call("projects.create", { name: "Acme delivery" });
      const { project: destination } = await env.client.call("projects.create", { name: "Northwind delivery" });
      const created = await env.client.call("agents.create", {
        project_id: project.id,
        slug: "delivery",
        name: "Delivery",
      });
      const agent = env.core.store.agents.get(created.id);
      assert.ok(agent);
      const person = await env.client.call("contacts.set", {
        name: "Acme Buyer",
        agent_id: agent.id,
        perms: { notes: true },
      });
      const thread = env.core.store.threads.create({
        kind: "channel",
        title: person.name,
        agent_ids: [agent.id],
        project_id: project.id,
        channel: { id: "test", conversation: person.id, person_id: person.id },
      });
      const note = env.core.store.memories.add({
        text: "Delivery previous authorization marker",
        scope: "project",
        project_id: project.id,
        source: "agent",
        tainted: true,
      });
      let searches = 0;
      const call: ToolContext["call"] = async <M extends MethodName>(
        method: M,
        params: Params<M>,
      ): Promise<Result<M>> => {
        assert.equal(method, "memory.list");
        const found = await env.client.call(method, params);
        if (++searches === 3) {
          reached.resolve();
          await released.promise;
        }
        return found;
      };
      const ctx = { agent, thread, call } as ToolContext;
      const tool = contactTools(env.core.store).find((t) => t.name === "search_owner_notes");
      assert.ok(tool);
      const running = tool.run({ query: "delivery" }, ctx);
      const outcome = running.then(
        (result) => ({ result, error: undefined }),
        (error) => ({ result: undefined, error }),
      );
      await Promise.race([
        reached.promise,
        outcome.then(() => {
          throw new Error("lookup finished before its held search");
        }),
      ]);
      if (change === "notes revoked")
        await env.client.call("contacts.set", { id: person.id, name: person.name, perms: { notes: false } });
      if (change === "memory disabled") {
        const settings = await env.client.call("memory.settings", {});
        await env.client.call("memory.set_settings", { mode: "off", auto_compact: settings.auto_compact });
      }
      if (change === "contact reassigned")
        await env.client.call("contacts.set", { id: person.id, name: person.name, agent_id: null });
      if (change === "agent moved") env.core.store.agents.upsert({ ...agent, project_id: destination.id });
      if (change === "chat moved") env.core.store.threads.handTo(thread, agent.id, destination.id);
      if (change === "migration pending")
        env.core.store.agentMigrationPending.reserve({
          id: randomUUID(),
          agent: agent.id,
          source: project.id,
          destination: destination.id,
          threads: [thread.id],
        });
      if (change === "note edited")
        env.core.store.memories.edit(note.id, "Delivery replacement marker", { tainted: true, pending: false });
      if (change === "note forgotten") await env.client.call("memory.remove", { id: note.id });
      if (change === "note pending") env.core.store.memories.edit(note.id, note.text, { tainted: true, pending: true });
      released.resolve();
      const answer = await outcome;
      if (change.startsWith("note ")) {
        assert.equal(answer.error, undefined);
        assert.doesNotMatch(String(answer.result), /previous authorization marker|replacement marker/);
      } else {
        assert.ok(answer.error instanceof Error);
        assert.match(answer.error.message, /notes access changed/);
        assert.equal(answer.result, undefined);
      }
    } finally {
      released.resolve();
      await env.core.close();
      await env.cleanup();
    }
  });
}
