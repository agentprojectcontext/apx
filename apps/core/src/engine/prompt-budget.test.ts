import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { scratchDir } from "../tools/folders.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/**
 * What a fresh install's secretary sends on every model call, in characters (about four to a token): together about
 * 9,500 tokens. A change that needs more raises these here and in rules/PROMPT_SIZE.md, with the reason in its commit.
 */
const BUDGET = { system: 10_000, tools: 30_000 };

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
// Exercise a long native temp path, then measure its canonical spelling in the captured prompt.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), `apx-budget-${"long-".repeat(12)}`));
const FIXED = { TMPDIR: temp, TEMP: temp, TMP: temp, APX_CODE_SHA: "0123456789ab" };
const saved = Object.fromEntries(Object.keys(FIXED).map((k) => [k, process.env[k]]));
const restore = () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};
before(async () => {
  Object.assign(process.env, FIXED);
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
  restore();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("a default turn's system prompt and tools stay within the prompt budget", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "hola" });
  await env.settle(t.id);
  const call = llm.calls.at(-1);
  const prompt = String(call?.messages[0]?.content ?? "");
  const scratch = scratchDir(env.core.store, env.home, t);
  assert.ok(prompt.includes(scratch), "the captured prompt names the real chat temp folder");
  const system = prompt.replace(scratch, `/tmp/apx-scratch-01234567/${t.id}`).length;
  const tools = JSON.stringify(call?.tools ?? []).length;
  assert.ok(system <= BUDGET.system, `system prompt: ${system} chars, budget ${BUDGET.system} (rules/PROMPT_SIZE.md)`);
  assert.ok(tools <= BUDGET.tools, `tools: ${tools} chars, budget ${BUDGET.tools} (rules/PROMPT_SIZE.md)`);
});
