import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { VISUAL_CHECK } from "./context.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
const folder = tempDir("apx-visual-");

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await folder.remove();
});

const systemOf = async (thread: string) => {
  await env.client.call("threads.send", { thread, text: "hola" });
  await env.settle(thread);
  return String(llm.calls.at(-1)?.messages[0]?.content ?? "");
};

test("an agent working in a project is told to look at a visible change running, also outside a code folder", async () => {
  fs.writeFileSync(path.join(folder.path, "AGENTS.md"), "# AGENTS.md: Acme web\n");
  const { project } = await env.client.call("projects.register", { path: folder.path });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", project_id: project.id });
  assert.ok((await systemOf(t.id)).includes(VISUAL_CHECK));
});

test("a chat outside any project is not told it", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  assert.ok(!(await systemOf(t.id)).includes(VISUAL_CHECK));
});
