import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

// The model reads what recall returned and says it back, so the test sees the tool's output.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`seen: ${String(req.messages.at(-1)?.content)}`);
  if (said.startsWith("list:")) return callTool("l1", "recall", JSON.parse(said.slice(5)));
  return say("noted");
});

let env: Awaited<ReturnType<typeof startCore>>;
let project = "";
before(async () => {
  env = await startCore({ llm });
  await env.client.call("memory.set_settings", { mode: "notes", auto_compact: false, auto_dream: false });
  project = (await env.client.call("projects.create", { name: "Acme" })).project.id;
  const other = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
  for (const text of ["Acme deploys on Fridays.", "Acme invoices are in euros.", "Acme uses pnpm."])
    await env.client.call("memory.add", { scope: "project", project, text });
  await env.client.call("memory.add", { scope: "project", project: other, text: "Northwind ships by sea." });
  await env.client.call("memory.add", { scope: "global", text: "The owner signs with their first name." });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function ask(thread: string, args: Record<string, unknown>): Promise<string> {
  await env.client.call("threads.send", { thread, text: `list:${JSON.stringify(args)}` });
  const t = await env.settle(thread);
  return (
    t.messages
      .at(-1)
      ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("") ?? ""
  );
}

test("recall with no query lists the newest notes the agent may see, page by page", async () => {
  const thread = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    project_id: project,
  });
  const first = await ask(thread.id, { limit: 2 });
  const next = await ask(thread.id, { limit: 2, offset: 2 });
  const both = first + next;
  for (const text of ["deploys on Fridays", "invoices are in euros", "uses pnpm", "first name"])
    assert.equal(both.split(text).length - 1, 1, `"${text}" shows once across the two pages`);
  assert.doesNotMatch(both, /Northwind/, "another project's notes stay out");
  assert.match(await ask(thread.id, { offset: 4 }), /no more notes\./);
});

test("recall with words still searches, across what the agent may see", async () => {
  const thread = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    project_id: project,
  });
  assert.match(await ask(thread.id, { query: "invoices euros" }), /invoices are in euros/);
});
