import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { z } from "zod";
import { removeDir } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const WIDGET = { name: "w-ok", title: "OK", html: "<b>ok</b>" };

const llm = scriptedLlm(async (_req, { said, afterTool }) => {
  if (afterTool) return say("Turn done.");
  if (said.includes("it will run without asking")) return callTool("g1", "show_widget", WIDGET);
  if (said.includes("make a widget named")) {
    const name = said.split("make a widget named ")[1]?.split(" ")[0] ?? "w";
    return callTool(`c-${name}`, "show_widget", { name, title: name, html: "<i>x</i>" });
  }
  if (said.includes("make the ok widget")) return callTool("c-ok", "show_widget", WIDGET);
  if (said.includes("ask me"))
    return callTool("q1", "ask_owner", { question: "Which color?", options: ["red", "blue"] });
  if (said.includes("bad args")) return callTool("b1", "show_widget", { title: "no name" });
  if (said.includes("big output")) return callTool("o1", "big_output", {});
  return say("Hi.");
});

const big = defineTool({
  name: "big_output",
  description: "test tool",
  args: z.object({}),
  effect: "none",
  deadlineMs: 5_000,
  title: () => "Made a big output",
  run: async () => `${"a".repeat(20_000)}END`,
});

let env: Awaited<ReturnType<typeof startCore>>;
let careful = "";
let root = "";

/** A project agent whose file says `autonomy: ask`: every call that changes something waits for the owner. */
async function carefulAgent(client: ApxClient): Promise<string> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-inputs-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "Northwind" }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "careful.md"),
    "---\nname: Careful\nrole: tester\nautonomy: ask\n---\n\nYou check things.\n",
  );
  await client.call("projects.register", { path: root });
  const { agents } = await client.call("agents.list", {});
  const a = agents.find((x) => x.name === "Careful");
  // A file written before the five modes keeps asking (DECISIONS.md#d-106).
  assert.equal(a?.autonomy, "manual");
  return a.id;
}

const pendingOf = async (thread: string) => {
  for (let i = 0; i < 200; i++) {
    const { inputs } = await env.client.call("runs.pending", { thread });
    if (inputs.length) return inputs;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no pending input");
};

before(async () => {
  env = await startCore({ llm, extraTools: [big] });
  careful = await carefulAgent(env.client);
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(root);
});

const newThread = (agent: string) => env.client.call("threads.create", { kind: "agent", agent_id: agent });

test("an agent with autonomy ask waits for the owner; approving runs the tool and the turn goes on", async () => {
  const t = await newThread(careful);
  const sent = await env.client.call("threads.send", { thread: t.id, text: "make a widget named w-yes please" });
  const [input] = await pendingOf(t.id);
  assert.equal(input?.kind, "confirm");
  assert.equal(input?.tool, "show_widget");
  assert.match(input?.detail ?? "", /name: w-yes/);
  assert.equal((await env.client.call("runs.get", { run: sent.run.id })).state, "input-required");
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "input-required");

  const settled = await env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" });
  assert.equal(settled.state, "approved");
  const { messages, runs } = await env.settle(t.id);
  assert.equal(runs.at(-1)?.state, "completed");
  const { surfaces } = await env.client.call("surfaces.list", {});
  assert.ok(surfaces.some((s) => s.name === "w-yes"));
  const card = messages.at(-1)?.parts.find((p) => p.type === "input");
  assert.equal(card?.type === "input" && card.state, "approved");
});

test("denying returns 'not run' to the model and nothing happens; a second answer is refused", async () => {
  const t = await newThread(careful);
  await env.client.call("threads.send", { thread: t.id, text: "make a widget named w-no please" });
  const [input] = await pendingOf(t.id);
  await env.client.call("runs.respond", { input: input?.id ?? "", decision: "deny", text: "not now" });
  await env.settle(t.id);
  const { surfaces } = await env.client.call("surfaces.list", {});
  assert.ok(!surfaces.some((s) => s.name === "w-no"));
  const seen = llm.calls.at(-1)?.messages.at(-1);
  assert.match(String(seen?.content), /not run: the owner declined \(their note: not now\)/);
  await assert.rejects(
    env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" }),
    (e: unknown) => e instanceof ApxError && e.code === "conflict",
  );
});

test("canceling the turn closes its pending input as expired (a no)", async () => {
  const t = await newThread(careful);
  await env.client.call("threads.send", { thread: t.id, text: "make a widget named w-cancel please" });
  const [input] = await pendingOf(t.id);
  await env.client.call("threads.cancel", { thread: t.id });
  const { runs } = await env.settle(t.id);
  assert.equal(runs.at(-1)?.state, "canceled");
  await assert.rejects(env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" }));
  const { surfaces } = await env.client.call("surfaces.list", {});
  assert.ok(!surfaces.some((s) => s.name === "w-cancel"));
});

test("ask_owner waits for the owner's words, which come back to the model", async () => {
  const t = await newThread("roby");
  await env.client.call("threads.send", { thread: t.id, text: "ask me something" });
  const [input] = await pendingOf(t.id);
  assert.equal(input?.kind, "question");
  assert.deepEqual(input?.options, ["red", "blue"]);
  await assert.rejects(env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" }));
  await env.client.call("runs.respond", { input: input?.id ?? "", text: "blue" });
  await env.settle(t.id);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /The owner answered: blue/);
});

test("only the owner answers: an agent client is refused", async () => {
  const agentClient = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(
    agentClient.call("runs.respond", { input: "inp_x", decision: "approve" }),
    (e: unknown) => e instanceof ApxError && e.code === "unauthorized",
  );
});

test("invalid arguments go back to the model as the tool's result, without running it", async () => {
  const t = await newThread("roby");
  await env.client.call("threads.send", { thread: t.id, text: "bad args" });
  await env.settle(t.id);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /invalid arguments for show_widget: name/);
});

test("a big output reaches the model capped, with a ref read_output pages through", async () => {
  const t = await newThread("roby");
  await env.client.call("threads.send", { thread: t.id, text: "big output" });
  await env.settle(t.id);
  const seen = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.ok(seen.length < 13_000);
  const ref = /read_output ref=(\S+)\]/.exec(seen)?.[1];
  assert.ok(ref);
  assert.equal(env.core.store.runs.output(ref, t.id)?.endsWith("END"), true);
  assert.equal(env.core.store.runs.output(ref, "home"), undefined);
});

test("an answer that arrives after a restart wakes the agent, and the approved call runs once without asking", async () => {
  const t = await newThread(careful);
  await env.client.call("threads.send", { thread: t.id, text: "make the ok widget" });
  const [input] = await pendingOf(t.id);
  const home = env.home;
  await env.core.close();
  env = await startCore({ llm, home, extraTools: [big] });
  const still = (await env.client.call("runs.pending", { thread: t.id })).inputs;
  assert.equal(still[0]?.id, input?.id);
  await env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" });
  const { messages, runs } = await env.settle(t.id);
  // The turn that asked ended with the shutdown; the answer started a new one.
  assert.deepEqual(runs.map((r) => r.state).sort(), ["completed", "failed"]);
  const { surfaces } = await env.client.call("surfaces.list", {});
  assert.ok(surfaces.some((s) => s.name === "w-ok"));
  assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, []);
  assert.ok(texts(messages).includes("Turn done."));
});
