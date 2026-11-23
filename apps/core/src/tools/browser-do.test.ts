// browser_do through a running core and a fake desktop node: a sequence learned once is saved and run again by name.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const STEPS = [
  { do: "click", target: 'button "Create post"' },
  { do: "type", target: "Write something", text: "{{copy}}" },
  { do: "click", target: 'button "Schedule"', within: 'dialog "New post"' },
  { do: "wait", text: "Scheduled" },
];

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.findLast((m) => m.role === "tool")?.content)}`);
  if (said.includes("learn"))
    return callTool("d1", "browser_do", {
      tab: "t1",
      steps: STEPS,
      vars: { copy: "First post" },
      save_as: "schedule-post",
      about: "Schedule a post on the example admin",
    });
  if (said.includes("again"))
    return callTool("d2", "browser_do", { tab: "t1", recipe: "schedule-post", vars: { copy: "Second post" } });
  if (said.includes("unknown")) return callTool("d3", "browser_do", { tab: "t1", recipe: "nope-recipe" });
  if (said.includes("missing")) return callTool("d4", "browser_do", { tab: "t1", recipe: "schedule-post" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let desktop: ApxSocket;
const actions: string[] = [];
let scheduled = false;
let composing = false;

/** The admin page as its snapshot reads, after what was clicked so far. */
const tree = () =>
  [
    '<untrusted_web source="https://admin.example.com/">',
    '- button "Create post" [e1]',
    ...(composing ? ['- dialog "New post"', '  - textbox "Write something" [e2]', '  - button "Schedule" [e3]'] : []),
    ...(scheduled ? ['- status "Scheduled"'] : []),
    "</untrusted_web>",
  ].join("\n");

before(async () => {
  env = await startCore({ llm });
  desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
  desktop.onRequest(async (method, params) => {
    const p = params as Record<string, unknown>;
    if (method === "browser.tabs")
      return {
        tabs: [
          {
            tab: "t1",
            url: "https://admin.example.com/",
            title: "Admin",
            profile: "shared",
            control: { kind: "idle" },
          },
        ],
      };
    if (method === "browser.hold") return { ok: true };
    if (method === "browser.snapshot")
      return { url: "https://admin.example.com/", title: "Admin", tree: tree(), refs: 3, truncated: false };
    if (method === "browser.click") {
      actions.push(`click ${p.ref} by ${p.by}`);
      if (p.ref === "e1") composing = true;
      if (p.ref === "e3") {
        composing = false;
        scheduled = true;
      }
      return { ok: true, url: "https://admin.example.com/" };
    }
    if (method === "browser.type") {
      actions.push(`type ${p.ref} ${p.text}`);
      return { ok: true, url: "https://admin.example.com/" };
    }
    throw new Error(`unknown ${method}`);
  });
});
after(async () => {
  desktop.close();
  await env.core.close();
  await env.cleanup();
});

async function turn(text: string) {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
  await env.client.call("threads.send", { thread, text });
  await env.settle(thread);
  const messages = (await env.client.call("threads.get", { thread })).messages;
  const tool = messages.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.tool === "browser_do");
  return { thread, tool: tool?.type === "tool" ? tool : undefined };
}

const recipeFiles = () =>
  fs
    .readdirSync(env.home, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(path.join(".apc", "browser-recipes", "schedule-post.json")));

test("steps run in one call, as the agent, and a sequence that worked is saved with a note to find it", async () => {
  const { tool } = await turn("learn to schedule");
  assert.equal(tool?.status, "ok", tool?.detail);
  assert.deepEqual(actions, ["click e1 by superagent", "type e2 First post", "click e3 by superagent"]);
  assert.match(tool?.detail ?? "", /all 4 steps done/);
  assert.match(tool?.detail ?? "", /saved as recipe schedule-post with vars copy/);
  const [file] = recipeFiles();
  assert.ok(file, "the recipe is a file of the agent's project");
  const saved = JSON.parse(fs.readFileSync(path.join(env.home, file), "utf8"));
  assert.deepEqual(saved.steps, STEPS, "saved with its variables, not this run's values");
  assert.deepEqual(saved.vars, ["copy"]);
  const notes = (await env.client.call("memory.list", {})).memories.map((m) => m.text);
  assert.ok(notes.some((t) => t.includes('browser_do recipe "schedule-post"')));
});

test("a saved recipe runs by name with new values", async () => {
  actions.length = 0;
  scheduled = false;
  const { tool } = await turn("do it again");
  assert.equal(tool?.status, "ok", tool?.detail);
  assert.deepEqual(actions, ["click e1 by superagent", "type e2 Second post", "click e3 by superagent"]);
});

test("an unknown recipe names the saved ones, and missing values stop it before anything runs", async () => {
  actions.length = 0;
  const unknown = await turn("unknown recipe");
  assert.equal(unknown.tool?.status, "error");
  assert.match(unknown.tool?.detail ?? "", /no recipe nope-recipe.*saved: schedule-post/);
  const missing = await turn("missing values");
  assert.equal(missing.tool?.status, "error");
  assert.match(missing.tool?.detail ?? "", /missing vars: copy/);
  assert.deepEqual(actions, []);
});
