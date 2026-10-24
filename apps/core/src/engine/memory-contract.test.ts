import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { openDb } from "../db/db.ts";
import { memorySourceWindow } from "../domain/memory-evidence.ts";
import { qb, sql } from "../domain/sql.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const preference = "I always prefer CSV for internal reports.";
function gate() {
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

for (const action of ["quota", "forget"] as const)
  test(`capture rechecks ${action} between extraction and review`, async () => {
    const entered = gate(),
      response = gate();
    let reviews = 0;
    const llm = scriptedLlm(async (req, { system }) => {
      if (system.startsWith(action === "quota" ? "Extract durable" : "Validate memory")) {
        entered.release();
        await response.wait;
      }
      if (system.startsWith("Extract durable")) {
        const { messages } = JSON.parse(String(req.messages.at(-1)?.content));
        return say(
          JSON.stringify({
            memories: [{ kind: "feedback", message_id: messages[0].id, quote: preference, fact: preference }],
          }),
        );
      }
      if (system.startsWith("Validate memory")) {
        reviews++;
        return say('{"verdicts":[{"index":0,"verdict":"supported"}]}');
      }
      return say("Understood.");
    });
    const env = await startCore({ llm, aux: true, memoryMaintenance: true });
    try {
      const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Contract" });
      await env.client.call("threads.send", { thread: t.id, text: preference });
      await env.settle(t.id);
      await entered.wait;
      if (action === "quota")
        await env.client.call("memory.set_settings", { mode: "notes", auto_compact: false, daily_memory_calls: 1 });
      else {
        const note = await env.client.call("memory.add", { scope: "agent", agent: "roby", text: preference });
        await env.client.call("memory.remove", { id: note.id });
      }
      response.release();
      await waitFor(() => env.core.store.memoryWork.recent().every((j) => j.state !== "working"));
      assert.equal((await env.client.call("memory.list", {})).memories.length, 0);
      if (action === "quota") {
        assert.equal(reviews, 0);
        assert.match(env.core.store.memoryWork.recent().find((j) => j.kind === "capture")?.result ?? "", /extracted/);
      } else assert.equal(reviews, 1);
    } finally {
      response.release();
      await env.core.close();
      await env.cleanup();
    }
  });

test("the canonical memory handlers reject uncertified synthesis and retirement", async () => {
  let source = "";
  let old = "",
    newer = "";
  const tools = [
    defineTool({
      name: "forge_memory",
      description: "Try an unsupported memory write",
      args: z.object({}),
      effect: "none",
      deadlineMs: 1000,
      title: () => "Write memory",
      async run(_, ctx) {
        if (!source) return "no source";
        await ctx.call("memory.add", {
          scope: "agent",
          kind: "feedback",
          text: preference,
          evidence: [{ message_id: source, quote: preference }],
        });
        return "accepted";
      },
    }),
    defineTool({
      name: "retire_memory",
      description: "Try a retirement",
      args: z.object({}),
      effect: "none",
      deadlineMs: 1000,
      title: () => "Retire memory",
      async run(_, ctx) {
        return JSON.stringify(
          await ctx.call("memory.tidy", { retire: [{ id: old, revision: 1, by: newer, by_revision: 1 }] }),
        );
      },
    }),
  ];
  const env = await startCore({
    llm: scriptedLlm((_req, { said, afterTool }) =>
      afterTool
        ? say("Done")
        : said.includes("retire")
          ? callTool("retire", "retire_memory", {})
          : said.includes("forge")
            ? callTool("forge", "forge_memory", {})
            : say("Understood"),
    ),
    extraTools: tools,
  });
  try {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: t.id, text: preference });
    await env.settle(t.id);
    source = env.core.store.memorySources.forRun(env.core.store.runs.list(t.id)[0]?.id ?? "")[0] ?? "";
    assert.ok(source);
    await env.client.call("threads.send", { thread: t.id, text: "forge memory" });
    await env.settle(t.id);
    assert.equal((await env.client.call("memory.list", {})).memories.length, 0);
    const failed = env.core.store.runs.steps(env.core.store.runs.list(t.id)[0]?.id ?? "");
    assert.equal(failed[0]?.state, "error");
    const add = (text: string) =>
      env.core.store.memories.add({
        scope: "agent",
        agent_id: "roby",
        source: "agent",
        author_agent: "roby",
        text,
        tainted: false,
      });
    old = add(preference).id;
    newer = add("I prefer English for international invoices.").id;
    await env.client.call("threads.send", { thread: t.id, text: "retire memory" });
    await env.settle(t.id);
    assert.equal(env.core.store.memories.get(old)?.forgotten_at, undefined);
    assert.equal((await env.client.call("memory.list", {})).memories.length, 2);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a source window excludes a later run even when every timestamp is identical", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Understood")) });
  try {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sent = await env.client.call("threads.send", {
        thread: t.id,
        text: `I always prefer label ${i} for reports.`,
      });
      ids.push(sent.run.id);
      await env.settle(t.id);
    }
    const db = openDb(env.home);
    try {
      sql(db).run(
        qb
          .updateTable("runs")
          .set({ started_at: "2020-01-01T00:00:00.000Z", created_at: "2020-01-01T00:00:00.000Z" })
          .where("thread_id", "=", t.id),
      );
    } finally {
      db.close();
    }
    const anchor = env.core.store.runs.get(ids[3] ?? "");
    assert.ok(anchor);
    assert.deepEqual(
      memorySourceWindow(env.core.store, anchor).map((s) => s.run_id),
      [ids[3], ids[2], ids[1]],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("invalid extraction is retried instead of poisoning a durable checkpoint", async () => {
  let extracts = 0;
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Extract durable")) {
      extracts++;
      if (extracts === 1) return say('{"memories":[{"kind":"procedure","fact":"unsupported"}]}');
      const { messages } = JSON.parse(String(req.messages.at(-1)?.content));
      return say(
        JSON.stringify({
          memories: [{ kind: "feedback", message_id: messages[0].id, quote: preference, fact: preference }],
        }),
      );
    }
    if (system.startsWith("Validate memory")) return say('{"verdicts":[{"index":0,"verdict":"supported"}]}');
    return say("Understood");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    await env.client.call("memory.set_settings", { mode: "notes", auto_compact: false, auto_dream: false });
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Checkpoint" });
    await env.client.call("threads.send", { thread: t.id, text: preference });
    await env.settle(t.id);
    await waitFor(() => env.core.store.memoryWork.recent().some((j) => !!j.error));
    const job = env.core.store.memoryWork.recent().find((j) => j.kind === "capture");
    assert.ok(job);
    assert.deepEqual(JSON.parse(job.result ?? "{}"), {});
    env.core.store.memoryWork.defer(job.id, "retry", new Date(0).toISOString());
    await env.client.call("memory.maintenance", {});
    await waitFor(() => env.core.store.memories.list({ agent_id: "roby", limit: 100 }).length > 0);
    assert.equal(extracts, 2);
    assert.equal(env.core.store.memories.list({ agent_id: "roby", limit: 100 })[0]?.text, preference);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("transient work consumes no capture calls while its original chat remains searchable", async () => {
  let captures = 0;
  const llm = scriptedLlm((_, { system }) => {
    if (system.startsWith("Extract durable")) captures++;
    return say("Understood");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Temporary work" });
    const sent = await env.client.call("threads.send", {
      thread: t.id,
      text: `Download the Acme resource and check the resulting artifact. ${"Transient control row. ".repeat(500)}`,
    });
    await env.settle(t.id);
    await waitFor(() =>
      env.core.store.memoryWork.recent().some((j) => j.kind === "capture" && j.state === "completed"),
    );
    assert.equal(captures, 0);
    assert.ok(env.core.store.memorySources.forRun(sent.run.id).length);
    assert.equal((await env.client.call("memory.list", {})).memories.length, 0);
    const recalled = env.core.store.memoryWork.searchEpisodes("Acme resource", [t.id], 5);
    assert.ok(recalled.some((e) => e.run_id === sent.run.id));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an imperative use request is not a standing preference", async () => {
  const { durableMemory } = await import("../domain/memory-content.ts");
  assert.equal(durableMemory("Usá CSV para este informe."), false);
  assert.equal(durableMemory("Use CSV for this report."), false);
  assert.equal(durableMemory("Usá CSV siempre para informes internos."), true);
  assert.equal(durableMemory("El equipo usa CSV para informes internos."), true);
  for (const normalization of ["NFC", "NFD"] as const)
    assert.equal(
      durableMemory("Incluí heading; si no conocés preferencia duradera, usá resumen.".normalize(normalization)),
      false,
    );
});

test("a quoted output fallback cannot become a standing preference even if the helper approves it", async () => {
  const fallback = "Incluí heading; si no conocés preferencia duradera, usá resumen.";
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Extract durable")) {
      const { messages } = JSON.parse(String(req.messages.at(-1)?.content));
      const source = messages.find((m: { text: string }) => m.text.includes(fallback));
      return say(
        JSON.stringify({
          memories: source
            ? [
                {
                  kind: "reference",
                  message_id: source.id,
                  quote: fallback,
                  fact: "Informe debe incluir resumen si no se conocen preferencias duraderas.",
                },
              ]
            : [],
        }),
      );
    }
    if (system.startsWith("Validate memory")) return say('{"verdicts":[{"index":0,"verdict":"supported"}]}');
    return say("Understood");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    for (const text of [preference, `Prepará informe ejecutivo nuevo. ${fallback}`]) {
      await env.client.call("threads.send", { thread: t.id, text });
      await env.settle(t.id);
      await waitFor(() => env.core.store.memoryWork.recent().every((j) => j.state === "completed"));
    }
    assert.equal((await env.client.call("memory.list", {})).memories.length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
