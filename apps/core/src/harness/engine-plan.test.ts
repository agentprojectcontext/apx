import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Message, Part } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { claudeHarness } from "./claude.ts";
import { codexHarness } from "./codex.ts";
import { engineChecklist } from "./engine-plan.ts";
import { fakeProgram } from "./fake-program.test-support.ts";

// An outside engine's own checklist is APX's plan, and Claude Code, which has none here, is steered to it
// (DECISIONS.md#d-192).

let dir: TempDir;
let env: Awaited<ReturnType<typeof startCore>>;
let project = "";
let codexArgs = "";
let claudeSeen = "";
const savedOptions = process.env.NODE_OPTIONS;

/** A `codex exec --experimental-json` that records its arguments and plans as Codex does: started, updated, completed. */
function fakeCodex() {
  const item = (items: Array<[string, boolean]>) => ({
    id: "todo-1",
    type: "todo_list",
    items: items.map(([text, completed]) => ({ text, completed })),
  });
  const events = [
    { type: "thread.started", thread_id: "codex-thread" },
    {
      type: "item.started",
      item: item([
        ["Read the page", false],
        ["Write the copy", false],
      ]),
    },
    {
      type: "item.updated",
      item: item([
        ["Read the page", true],
        ["Write the copy", false],
      ]),
    },
    // The same list again: no second plan call.
    {
      type: "item.updated",
      item: item([
        ["Read the page", true],
        ["Write the copy", false],
      ]),
    },
    { type: "item.completed", item: { id: "m1", type: "agent_message", text: "Copy is next." } },
    {
      type: "item.completed",
      item: item([
        ["Read the page", true],
        ["Write the copy", false],
      ]),
    },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ];
  codexArgs = path.join(dir.path, "codex-args.json");
  return fakeProgram(
    dir.path,
    "codex",
    `require("node:fs").writeFileSync(${JSON.stringify(codexArgs)}, JSON.stringify(argv));
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(${JSON.stringify(events.map((e) => JSON.stringify(e)).join("\n"))} + "\\n"));`,
  );
}

/** A `claude` that records its arguments and its initialize request, then answers at once. */
function fakeClaude() {
  claudeSeen = path.join(dir.path, "claude-seen.json");
  const bin = path.join(dir.path, "claude.js");
  fs.writeFileSync(
    bin,
    `const fs = require("node:fs");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request") {
    if (m.request.subtype === "initialize")
      fs.writeFileSync(${JSON.stringify(claudeSeen)}, JSON.stringify({ argv: process.argv.slice(2), init: m.request }));
    send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  } else if (m.type === "user") {
    send({ type: "system", subtype: "init", model: "fixture-model", session_id: "claude-session" });
    send({ type: "result", subtype: "success", result: "Done", session_id: "claude-session", modelUsage: {}, usage: { input_tokens: 1, output_tokens: 1 } });
  }
});
`,
  );
  return bin;
}

before(async () => {
  dir = tempDir("apx-engine-plan-");
  const codex = fakeCodex();
  // The harness passes the core's environment on: the stand-in's own needs go there.
  Object.assign(process.env, codex.env);
  const claude = fakeClaude();
  const stub = { command: { command: "true", args: [], env: {} }, close() {} };
  env = await startCore({
    llm: scriptedLlm(() => say("native")),
    harnesses: {
      codex: codexHarness({ codexPath: async () => codex.bin, cwd: () => dir.path, gate: () => stub }),
      claude: claudeHarness({ claudePath: async () => claude, cwd: () => dir.path, readImage: () => undefined }),
    },
  });
  project = (await env.client.call("projects.register", { path: dir.path, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await dir.remove();
  if (savedOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = savedOptions;
});

const plansIn = (messages: Message[]) =>
  messages.flatMap((m) => m.parts.filter((p): p is Extract<Part, { type: "plan" }> => p.type === "plan"));

test("Codex's own plan is the live checklist under its answer, kept through APX's plan tool", async () => {
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "superagent",
    project_id: project,
    engine: "codex",
  });
  await env.client.call("threads.send", { thread: t.id, text: "rewrite the landing copy" });
  const { messages, runs } = await env.settle(t.id);
  const plans = plansIn(messages);
  assert.equal(plans.length, 1, "one plan part, updated in place");
  // At the turn's end no step is at work any more.
  assert.deepEqual(plans[0]?.steps, [
    { step: "Read the page", state: "done" },
    { step: "Write the copy", state: "pending" },
  ]);
  // Each change once: the first open step was at work while the turn ran.
  const steps = env.core.store.runs.steps(runs[0]?.id ?? "").filter((s) => s.tool === "plan");
  assert.deepEqual(
    steps.map((s) => (s.args as { steps: string }).steps),
    [
      "- [~] Read the page\n- [ ] Write the copy",
      "- [x] Read the page\n- [~] Write the copy",
      "- [x] Read the page\n- [ ] Write the copy",
    ],
  );
  // Codex's plan tool is off unless asked for.
  const args = JSON.parse(fs.readFileSync(codexArgs, "utf8")) as string[];
  assert.ok(args.includes("tools.update_plan.enabled=true"), args.join(" "));
});

test("Claude Code is steered to APX's plan, and its own task list, subagents and questions are not offered", async () => {
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "superagent",
    project_id: project,
    engine: "claude",
  });
  await env.client.call("threads.send", { thread: t.id, text: "hello" });
  await env.settle(t.id);
  const seen = JSON.parse(fs.readFileSync(claudeSeen, "utf8")) as { argv: string[]; init: Record<string, unknown> };
  assert.match(String(seen.init.appendSystemPrompt), /Your checklist here is mcp__apx__plan/);
  const tools = (seen.argv[seen.argv.indexOf("--tools") + 1] ?? "").split(",");
  assert.ok(tools.includes("Bash"), seen.argv.join(" "));
  for (const own of ["TodoWrite", "TaskCreate", "TaskUpdate", "Task", "Agent", "AskUserQuestion", "ExitPlanMode"])
    assert.ok(!tools.includes(own), `${own} is offered`);
});

test("an engine's checklist is cut to what the plan tool takes: one line per step, within its cap", () => {
  assert.equal(engineChecklist([{ step: " Read\n the page ", state: "doing" }]), "- [~] Read the page");
  assert.equal(engineChecklist([{ step: "  ", state: "pending" }]), undefined);
  const long = Array.from({ length: 40 }, (_, i) => ({ step: `${i} ${"x".repeat(300)}`, state: "pending" as const }));
  const text = engineChecklist(long) ?? "";
  assert.ok(text.length <= 4000 && text.split("\n").length < 40);
  assert.ok(text.split("\n").every((l) => l.startsWith("- [ ] ")));
});
