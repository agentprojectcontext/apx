import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

for (const options of [
  ["Done", "Not yet"],
  ["Ya está", "Todavía no"],
]) {
  test(`a readiness answer reaches its task agent and releases only the native wait: ${options[0]}`, async () => {
    const model = scriptedLlm((req, { afterTool, said }) =>
      afterTool || req.messages.some((message) => message.role === "tool") || said.includes("Their answer:")
        ? say("Readiness received; verification is still needed.")
        : callTool("ready", "ask_owner", {
            question:
              options[0] === "Done"
                ? "Is the lab device unlocked?"
                : "¿Ya está desbloqueado el dispositivo de laboratorio?",
            options,
          }),
    );
    const env = await startCore({ llm: model });
    try {
      const task = await env.client.call("tasks.create", {
        title: "Check lab readiness",
        description: "Ask whether the lab device is ready before verification.",
        assignee: "superagent",
        status: "doing",
      });
      let input: ReturnType<typeof env.core.store.inputs.pending>[number] | undefined;
      await waitFor(() => {
        input = env.core.store.threads.byTask(task.id).flatMap((thread) => env.core.store.inputs.pending(thread.id))[0];
        return Boolean(input);
      }, "readiness card");
      assert.ok(input);
      const question = (await env.client.call("threads.get", { thread: input.thread_id })).messages
        .flatMap((message) => message.parts)
        .find((part) => part.type === "input" && part.input_id === input?.id);
      assert.ok(question?.type === "input");
      assert.equal(question.kind, "question");
      assert.deepEqual(question.options, options);
      assert.equal(question.state, "pending");
      assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, true);
      const offered = model.calls[0]?.tools.find((tool) => tool.function.name === "ask_owner");
      assert.ok(offered);
      assert.match(JSON.stringify(offered.function.parameters), /confirmation or readiness check/);
      assert.match(JSON.stringify(offered.function.parameters), /use action instead/);
      await env.client.call("runs.respond", { input: input.id, text: options[0] });
      await env.settle(input.thread_id);
      assert.ok(
        model.calls.some((call) =>
          call.messages.some(
            (message) =>
              message.role === "tool" && String(message.content).includes(`The owner answered: ${options[0]}`),
          ),
        ),
      );
      assert.equal(env.core.store.inputs.get(input.id)?.state, "answered");
      assert.equal(env.core.store.tasks.get(task.id)?.awaits_owner, false);
      assert.equal(env.core.store.tasks.get(task.id)?.state, "open");
      await assert.rejects(env.client.call("runs.respond", { input: input.id, text: options[0] }));
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}
