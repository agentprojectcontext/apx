import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { memorySourceWindow } from "../domain/memory-evidence.ts";
import { observedFileResult } from "../domain/memory-verification.ts";
import { waitFor } from "../testkit/platform.ts";
import { scratchDir } from "../tools/folders.ts";
import { defineTool } from "../tools/types.ts";
import { procedureOf } from "./memory-procedure.ts";
import { supportMemoryClaims } from "./memory-testkit.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const quote = "Prefiero CSV para informes internos y PDF para clientes.";
const wrong = "Prefiero PDF para informes internos además CSV para clientes.";
const correct = "Prefiero CSV para informes internos y PDF para clientes.";

test("semantic review rejects reversed relationships even when the same words pass lexical checks", async () => {
  let reviews = 0;
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Extract durable")) {
      const { messages } = JSON.parse(String(req.messages.at(-1)?.content));
      return say(JSON.stringify({ memories: [{ kind: "feedback", message_id: messages[0].id, quote, fact: wrong }] }));
    }
    if (system.startsWith("Validate memory")) {
      reviews++;
      return say('{"verdicts":[{"index":0,"verdict":"contradicted"}]}');
    }
    if (system.startsWith("Review private")) return say('{"groups":[]}');
    return say("Understood.");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: quote });
    await env.settle(thread.id);
    await waitFor(() =>
      env.core.store.memoryWork.recent().some((j) => j.kind === "capture" && j.state === "completed"),
    );
    assert.equal(reviews, 1);
    assert.equal(env.core.store.memories.list({ scope: "agent", agent_id: "roby", limit: 100 }).length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a capture checkpoint resumes validation after quota exhaustion without extracting again", async () => {
  let extractions = 0;
  let reviews = 0;
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Extract durable")) {
      extractions++;
      const { messages } = JSON.parse(String(req.messages.at(-1)?.content));
      return say(
        JSON.stringify({ memories: [{ kind: "feedback", message_id: messages[0].id, quote, fact: correct }] }),
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
    await env.client.call("memory.set_settings", {
      mode: "notes",
      auto_compact: false,
      auto_dream: false,
      daily_memory_calls: 1,
    });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: quote });
    await env.settle(thread.id);
    await waitFor(() => env.core.store.memoryWork.recent().some((j) => j.error?.includes("budget")));
    assert.equal(extractions, 1);
    assert.equal(reviews, 0);
    assert.equal(env.core.store.memories.list({ scope: "agent", agent_id: "roby", limit: 100 }).length, 0);
    const job = env.core.store.memoryWork.recent().find((j) => j.kind === "capture");
    assert.ok(job);
    await env.client.call("memory.set_settings", {
      mode: "notes",
      auto_compact: false,
      auto_dream: false,
      daily_memory_calls: 2,
    });
    env.core.store.memoryWork.defer(job.id, "resume", new Date(0).toISOString());
    await env.client.call("memory.maintenance", {});
    await waitFor(() => env.core.store.memories.list({ scope: "agent", agent_id: "roby", limit: 100 }).length === 1);
    assert.equal(extractions, 1);
    assert.equal(reviews, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a recovered tool call alone never becomes a verified procedure", async () => {
  let attempts = 0;
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Extract durable")) return say('{"memories":[]}');
    if (system.startsWith("Review private")) return say('{"groups":[]}');
    const results = req.messages.filter((m) => m.role === "tool").length;
    return results < 2
      ? callTool(`export-${results}`, "export_asset", { path: "artifact.csv" })
      : say("The tool returned ok.");
  });
  const env = await startCore({
    llm,
    aux: true,
    memoryMaintenance: true,
    extraTools: [
      defineTool({
        name: "export_asset",
        description: "Export an asset",
        args: z.object({ path: z.string() }),
        effect: "none",
        deadlineMs: 1000,
        title: () => "Export asset",
        async run() {
          attempts++;
          if (attempts === 1) throw new Error("temporary export failure");
          return "ok";
        },
      }),
    ],
  });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: thread.id, text: "Create the artifact and check its contents." });
    await env.settle(thread.id);
    assert.equal(attempts, 2);
    assert.equal(
      env.core.store.memories
        .list({ scope: "agent", agent_id: "roby", limit: 100 })
        .filter((m) => m.kind === "procedure").length,
      0,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a historical source is still available after seventy later owner turns", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    const first = await env.client.call("threads.send", { thread: thread.id, text: quote });
    await env.settle(thread.id);
    for (let i = 0; i < 70; i++) {
      await env.client.call("threads.send", { thread: thread.id, text: `Later discussion number ${i}.` });
      await env.settle(thread.id);
    }
    const run = env.core.store.runs.get(first.run.id);
    assert.ok(run);
    assert.deepEqual(
      memorySourceWindow(env.core.store, run).map((s) => s.text),
      [quote],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("capture joins two authorized owner statements and preserves both sources", async () => {
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
    if (system.startsWith("Extract durable")) {
      const { messages } = JSON.parse(String(req.messages.at(-1)?.content));
      if (messages.length !== 2) return say('{"memories":[]}');
      return say(
        JSON.stringify({
          memories: [
            {
              kind: "feedback",
              fact: correct,
              evidence: messages.map((m: { id: string; text: string }) => ({ message_id: m.id, quote: m.text })),
            },
          ],
        }),
      );
    }
    if (system.startsWith("Review private")) return say('{"groups":[]}');
    return say("Understood.");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    for (const text of ["Prefiero CSV para informes internos.", "Prefiero PDF para clientes."]) {
      await env.client.call("threads.send", { thread: thread.id, text });
      await env.settle(thread.id);
    }
    await waitFor(() => env.core.store.memories.list({ scope: "agent", agent_id: "roby", limit: 100 }).length === 1);
    const [note] = (await env.client.call("memory.list", { agent: "roby" })).memories;
    assert.equal(note?.text, correct);
    assert.equal(note.evidence?.length, 2);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("only a complete readback can verify a file result", () => {
  const write = {
    call_id: "write",
    tool: "file_write",
    args: { path: "report.txt", content: "alpha" },
    effect: "local",
    state: "ok" as const,
    result: "ok",
  };
  const read = {
    call_id: "read",
    tool: "file_read",
    args: { path: "report.txt", limit: 1 },
    effect: "none",
    state: "ok" as const,
    result: 'report.txt: lines 1-1 of 2 (more: offset=2)\n<file trust="untrusted">\nalpha\n</file>',
  };
  assert.equal(observedFileResult([write, read]), undefined);
  read.result = 'report.txt: lines 1-1 of 1\n<file trust="untrusted">\nalpha\n</file>';
  assert.deepEqual(observedFileResult([write, read])?.step_ids, ["write", "read"]);
  read.result = read.result.replace("alpha", "alpha ");
  assert.equal(observedFileResult([write, read]), undefined);
});

test("real file tools record the readback evidence after recovering from an error", async () => {
  let output = "";
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Extract durable")) return say('{"memories":[]}');
    if (system.startsWith("Review private")) return say('{"groups":[]}');
    const count = req.messages.filter((m) => m.role === "tool").length;
    if (count === 0) return callTool("missing", "export_probe", {});
    if (count === 1) return callTool("write", "file_write", { path: output, content: "verified contents" });
    if (count === 2) return callTool("read", "file_read", { path: output });
    return say("File contents checked.");
  });
  const env = await startCore({
    llm,
    aux: true,
    memoryMaintenance: true,
    extraTools: [
      defineTool({
        name: "export_probe",
        description: "Check export availability",
        args: z.object({}),
        effect: "none",
        deadlineMs: 1000,
        title: () => "Check export",
        async run() {
          throw new Error("export unavailable");
        },
      }),
    ],
  });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    output = path.join(scratchDir(env.core.store, env.home, thread), "report.txt");
    await env.client.call("threads.send", {
      thread: thread.id,
      text: "Write the report and check the resulting file.",
    });
    await env.settle(thread.id);
    const run = env.core.store.runs.list(thread.id, 1)[0];
    assert.ok(run);
    const steps = env.core.store.runs.steps(run.id);
    assert.ok(observedFileResult(steps), JSON.stringify(steps));

    await waitFor(() =>
      env.core.store.memories
        .list({ scope: "agent", agent_id: "roby", limit: 100 })
        .some((m) => m.kind === "procedure"),
    );
    const note = (await env.client.call("memory.list", { agent: "roby" })).memories.find((m) => m.kind === "procedure");
    assert.equal(note?.evidence?.[0]?.verification?.kind, "observed_result");
    assert.deepEqual(note?.evidence?.[0]?.verification?.step_ids, ["write", "read"]);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a fresh confirmation records proof even when the method has an unverified legacy note", async () => {
  const llm = scriptedLlm((_, { system, said, afterTool }) => {
    if (system.startsWith("Extract durable")) return say('{"memories":[]}');
    if (said === "Export the Acme asset." && !afterTool)
      return callTool("export", "export_asset", { route: "route-b" });
    return say("Understood.");
  });
  const env = await startCore({
    llm,
    aux: true,
    memoryMaintenance: true,
    extraTools: [
      defineTool({
        name: "export_asset",
        description: "Export an asset",
        args: z.object({ route: z.string() }),
        effect: "none",
        deadlineMs: 1000,
        title: () => "Export asset",
        async run() {
          return "ok";
        },
      }),
    ],
  });
  try {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Legacy proof" });
    const sent = await env.client.call("threads.send", { thread: thread.id, text: "Export the Acme asset." });
    await env.settle(thread.id);
    const run = env.core.store.runs.get(sent.run.id);
    assert.ok(run);
    const note = procedureOf(env.core.store, run, "2020-01-01");
    assert.ok(note);
    const legacy = env.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      author_agent: "roby",
      text: note.text,
      kind: "procedure",
      tainted: true,
      evidence: [{ message_id: note.message_id, quote: note.quote }],
    });
    await env.client.call("threads.send", { thread: thread.id, text: "Genial, funcionó" });
    await env.settle(thread.id);
    await waitFor(() =>
      env.core.store.memories
        .list({ agent_id: "roby", limit: 100 })
        .some((m) => m.evidence?.some((e) => e.verification?.kind === "owner_confirmation")),
    );
    assert.equal(env.core.store.memories.get(legacy.id)?.evidence?.[0]?.verification, undefined);
    const verified = env.core.store.memories
      .list({ agent_id: "roby", limit: 100 })
      .find((m) => m.evidence?.some((e) => e.verification));
    assert.match(verified?.text ?? "", /`export_asset` `route-b`/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
