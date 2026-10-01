import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Loaded: ${String(req.messages.at(-1)?.content).slice(0, 200)}`);
  if (said.includes("use the skill")) return callTool("k1", "load_skill", { name: "brief-writer" });
  if (said.includes("escape"))
    return callTool("k2", "load_skill", { name: "brief-writer", file: "../../secrets.index.json" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  const dir = path.join(env.home, "skills", "brief-writer");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    "---\nname: brief-writer\ndescription: Writes one-page briefs. Use it for client summaries.\n---\n\nStart with the goal.\n",
  );
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("agents see a one-line catalog and load the body on demand; files outside the skill are refused", async () => {
  const { skills } = await env.client.call("skills.list", {});
  assert.deepEqual(
    skills.map((s) => s.name),
    ["brief-writer"],
  );
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "skills" });
  await env.client.call("threads.send", { thread: t.id, text: "use the skill" });
  await env.settle(t.id);
  const system = String(llm.calls.at(-1)?.messages[0]?.content);
  assert.match(system, /## Skills[\s\S]*- brief-writer: Writes one-page briefs\./);
  assert.doesNotMatch(system, /Start with the goal/);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /Start with the goal/);
  await env.client.call("threads.send", { thread: t.id, text: "escape" });
  await env.settle(t.id);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /outside the skill/);
});
