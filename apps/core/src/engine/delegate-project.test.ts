// A project's agent works in its own project's folder wherever it is asked from, as far as its caller may and never
// more than its own project lets it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { realpath } from "../paths.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

let builder = "";
const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (said.includes("ask the builder") && !afterTool)
    return callTool("b1", "delegate", { agent: builder, task: "Check the build." });
  return say(afterTool ? "Done." : "Build checked.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const register = async (name: string) => {
  const dir = realpath(fs.mkdtempSync(path.join(os.tmpdir(), `apx-${name}-`)));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `# ${name}\n`);
  return { dir, id: (await env.client.call("projects.register", { path: dir, init: true })).project.id };
};

test("asked from another project's chat, a project's agent works in its own project", async () => {
  const north = await register("northwind");
  const acme = await register("acme");
  builder = (await env.client.call("agents.create", { slug: "builder", name: "Builder", project_id: acme.id })).id;
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: north.id });
  await env.client.call("threads.send", { thread: chat.id, text: "ask the builder" });
  await env.settle(chat.id);
  const [session] = env.core.store.threads.sessions(chat.id);
  assert.equal(session?.project_id, acme.id, "its own project, not the caller's");
  assert.equal(session?.cwd, undefined, "no folder of its own unless one is asked");
});
