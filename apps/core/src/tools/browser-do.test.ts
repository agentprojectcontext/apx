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
  const tries = req.messages.filter((m) => m.role === "tool").length;
  if (said.includes("broken batch") && tries < 3)
    return callTool(`b${tries}`, "browser_do", {
      tab: "t1",
      steps: [{ do: "click", target: 'button "Broken"' }],
      save_as: "broken-batch",
      about: "A batch whose button fails",
    });
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
  const attach = /^attach (\S+)/.exec(said)?.[1];
  if (attach)
    return callTool("d5", "browser_do", {
      tab: "t1",
      steps: [
        { do: "click", target: 'button "Create post"' },
        { do: "type", target: "Add an image", text: "{{image}}" },
      ],
      vars: { image: attach },
    });
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
    ...(composing
      ? [
          '- dialog "New post"',
          '  - textbox "Write something" [e2]',
          '  - button "Schedule" [e3]',
          '  - button "Add an image" [e4]',
        ]
      : []),
    ...(scheduled ? ['- status "Scheduled"'] : []),
    '- button "Broken" [e9]',
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
      if (p.ref === "e9") throw new Error("the page did not answer the click");
      actions.push(`click ${p.ref} by ${p.by}`);
      if (p.ref === "e1") composing = true;
      if (p.ref === "e3") {
        composing = false;
        scheduled = true;
      }
      return { ok: true, url: "https://admin.example.com/" };
    }
    if (method === "browser.type") {
      actions.push(`type ${p.ref} ${p.text}${p.upload ? " (attached)" : ""}`);
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

test("a file's full path, given as a value, is attached; a file the agent may not read is only text", async () => {
  const work = path.join(env.home, "work");
  fs.mkdirSync(work, { recursive: true });
  const image = path.join(work, "post-1.png");
  fs.writeFileSync(image, "png");
  actions.length = 0;
  composing = false;
  const ok = await turn(`attach ${image}`);
  assert.equal(ok.tool?.status, "ok", ok.tool?.detail);
  assert.deepEqual(actions, ["click e1 by superagent", `type e4 ${image} (attached)`]);
  // A file it may not read (APX's own folder) is never attached: typed as plain text, a file field then refuses it.
  const outside = path.join(env.home, "elsewhere.png");
  fs.writeFileSync(outside, "png");
  actions.length = 0;
  composing = false;
  await turn(`attach ${outside}`);
  assert.deepEqual(actions, ["click e1 by superagent", `type e4 ${outside}`]);
});

test("a broken sequence fails as an error that says to repair it, and after three tries to finish the rest and ask", async () => {
  const { thread } = await turn("run the broken batch");
  const tries = (await env.client.call("threads.get", { thread })).messages
    .flatMap((m) => m.parts)
    .filter((p) => p.type === "tool" && p.tool === "browser_do");
  assert.deepEqual(
    tries.map((p) => (p.type === "tool" ? p.status : "")),
    ["error", "error", "error"],
  );
  const detail = (i: number) => {
    const p = tries[i];
    return p?.type === "tool" ? (p.detail ?? "") : "";
  };
  assert.match(detail(0), /the page did not answer the click/);
  assert.match(detail(0), /Try 1 of 3 for this sequence for broken-batch.*Repair it yourself/s);
  assert.match(detail(1), /Try 2 of 3/);
  assert.match(detail(2), /Try 3 of 3: stop retrying.*finish every other part.*ask the owner one specific thing/s);
  const saved = fs.readdirSync(env.home, { recursive: true, encoding: "utf8" });
  assert.equal(saved.filter((f) => f.endsWith("broken-batch.json")).length, 0, "nothing broken is saved");
});
