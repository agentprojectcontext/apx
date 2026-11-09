import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

test("AutoDream tidies the notes a project shares and never touches the owner's", async () => {
  await using repo = tempDir("apx-shared-dream-");
  fs.writeFileSync(path.join(repo.path, "AGENTS.md"), "# Northwind\n");
  const seen: string[][] = [];
  const env = await startCore({
    aux: true,
    memoryMaintenance: true,
    llm: scriptedLlm((req, { system }) => {
      if (system.startsWith("Extract durable")) return say('{"memories":[]}');
      if (system.startsWith("Validate memory retirements"))
        return say('{"verdicts":[{"index":0,"verdict":"supported"}]}');
      if (system.startsWith("Review private memory")) return say('{"groups":[],"retire":[]}');
      if (!system.startsWith("Review memory notes a project's agents share")) return say("Understood");
      const { notes } = JSON.parse(String(req.messages.at(-1)?.content)) as { notes: { id: string; text: string }[] };
      seen.push(notes.map((n) => n.text));
      const id = (start: string) => notes.find((n) => n.text.startsWith(start))?.id;
      return say(
        JSON.stringify({
          groups: [[id("Northwind invoices"), id("northwind invoices")]],
          retire: [{ id: id("Northwind deploys on Fridays"), by: id("Northwind deploys on Thursdays") }],
        }),
      );
    }),
  });
  try {
    await env.client.call("memory.set_settings", { mode: "notes", auto_dream: false, auto_compact: false });
    const project = (await env.client.call("projects.register", { path: repo.path })).project.id;
    const thread = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      project_id: project,
    });
    await env.client.call("threads.send", { thread: thread.id, text: "Tidy up." });
    await env.settle(thread.id);
    const store = env.core.store;
    const add = async (text: string, source: "owner" | "agent" | "imported") => {
      const at = Date.now();
      while (Date.now() === at) await new Promise((r) => setTimeout(r, 1));
      return store.memories.add({ scope: "project", project_id: project, text, source, tainted: false });
    };
    const dupA = await add("Northwind invoices go out on Mondays.", "imported");
    const dupB = await add("northwind invoices go out on Mondays", "agent");
    const old = await add("Northwind deploys on Fridays.", "imported");
    const owner = await add("Northwind's owner word: keep invoices in EUR.", "owner");
    const fresh = await add("Northwind deploys on Thursdays now, not on Fridays.", "agent");
    // A pass forgets at most a fifth of what it reads.
    for (const place of ["Lisbon", "Oslo", "Quito", "Lima", "Accra", "Hanoi"])
      await add(`Northwind has a warehouse in ${place}.`, "agent");

    await env.client.call("memory.set_settings", { mode: "notes", auto_dream: true, auto_compact: false });
    await env.client.call("memory.maintenance", { dream: true });
    await waitFor(() =>
      store.memoryWork.recent().some((j) => j.id.startsWith("dream:shared:") && j.state === "completed"),
    );
    assert.equal(seen.length, 1, "one pass over the project's shared notes");
    assert.ok(!seen[0]?.includes(owner.text), "the owner's note is not on the shelf");
    const forgotten = (id: string) => Boolean(store.memories.get(id)?.forgotten_at);
    assert.equal(forgotten(dupA.id) !== forgotten(dupB.id), true, "the exact duplicate is merged into one");
    assert.ok(forgotten(old.id), "the corrected note is retired");
    assert.ok(!forgotten(fresh.id));
    assert.ok(!forgotten(owner.id));
    assert.equal(store.memories.history(old.id)[0]?.reason, `superseded:${fresh.id}`, "and can be brought back");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
