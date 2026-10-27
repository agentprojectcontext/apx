import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said }) =>
  said.includes("the owner just added") ? say("I saw it: want me to adapt it?") : say("ok"),
);

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const homeRuns = async () => (await env.client.call("threads.get", { thread: "home" })).runs;

test("a project or an agent the owner adds reaches the super-agent in Home, which offers to adapt it", async () => {
  const before = (await homeRuns()).length;
  const { project } = await env.client.call("projects.create", { name: "Northwind" });
  await waitFor(async () => (await homeRuns()).length > before, "a Home turn");
  await waitFor(async () => (await homeRuns()).every((r) => r.ended_at), "the turn ends");
  const input = String(
    llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes("just added"))?.messages.at(-1)?.content,
  );
  assert.match(input, new RegExp(`the owner just added the project .*Northwind.* \\(${project.id}\\)`));
  assert.match(input, /asking before you change anything/);

  const count = (await homeRuns()).length;
  await env.client.call("agents.create", { slug: "scout-two", name: "Scout Two", role: "Researcher", prompt: "Dig." });
  await waitFor(async () => (await homeRuns()).length > count, "a Home turn for the agent");
  assert.ok(llm.calls.some((c) => /just added the agent .*Scout Two/.test(String(c.messages.at(-1)?.content))));
});
