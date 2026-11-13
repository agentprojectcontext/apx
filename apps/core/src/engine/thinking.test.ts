// What a model says of its reasoning reaches the panel live while the turn has not answered, and is never kept.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoreEvent } from "@apx/protocol";
import type { Llm } from "../providers/llm.ts";
import { waitFor } from "../testkit/platform.ts";
import { startCore } from "./testkit.ts";

test("a turn's thinking is shown live, cleared once it answers, and kept nowhere", async () => {
  const llm: Llm = {
    label: () => "fake/fake-1",
    async complete(req) {
      req.onThinking?.("Reading the question");
      req.onThinking?.("Reading the question\n\nChecking the plan");
      req.onText?.("Here is the plan.");
      return { model: "fake/fake-1", finish: "stop", message: { role: "assistant", content: "Here is the plan." } };
    },
  };
  const env = await startCore({ llm });
  const seen: Extract<CoreEvent, { type: "run.thinking" }>[] = [];
  env.core.bus.on((e) => {
    if (e.type === "run.thinking") seen.push(e);
  });
  try {
    const { run } = await env.client.call("threads.send", { thread: "home", text: "What is the plan?" });
    await waitFor(() => TERMINAL_STATES.has(env.core.store.runs.get(run.id)?.state ?? ""), "the turn ended");
    assert.equal(seen[0]?.text, "Reading the question", "the first words show at once");
    assert.ok(seen.every((e) => e.run_id === run.id && e.thread_id === "home"));
    assert.equal(seen.at(-1)?.text, "", "cleared once the answer starts");
    const { messages } = await env.client.call("threads.get", { thread: "home" });
    const kept = JSON.stringify(messages);
    assert.ok(kept.includes("Here is the plan."));
    assert.ok(!kept.includes("Reading the question"), "the thinking is not in the chat");
  } finally {
    await env.core.close();
  }
});

test("what it last thought stays while it uses its tools, until it writes", async () => {
  const seen: string[] = [];
  let calls = 0;
  let duringTools: string[] = [];
  const llm: Llm = {
    label: () => "fake/fake-1",
    async complete(req) {
      calls++;
      if (calls === 1) {
        req.onThinking?.("**Listing the agents**");
        return {
          model: "fake/fake-1",
          finish: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "c1", type: "function", function: { name: "list_agents", arguments: "{}" } }],
          },
        };
      }
      duringTools = [...seen];
      req.onText?.("Two agents.");
      return { model: "fake/fake-1", finish: "stop", message: { role: "assistant", content: "Two agents." } };
    },
  };
  const env = await startCore({ llm });
  env.core.bus.on((e) => {
    if (e.type === "run.thinking") seen.push(e.text);
  });
  try {
    const { run } = await env.client.call("threads.send", { thread: "home", text: "Who is here?" });
    await waitFor(() => TERMINAL_STATES.has(env.core.store.runs.get(run.id)?.state ?? ""), "the turn ended");
    assert.equal(calls, 2, "the tool ran and the model was asked again");
    assert.deepEqual(duringTools, ["**Listing the agents**"], "not cleared by the tool call");
    assert.equal(seen.at(-1), "", "cleared once it writes");
  } finally {
    await env.core.close();
  }
});

const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);
