import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const probe = defineTool({
  name: "probe",
  description: "test tool that always asks the owner",
  args: z.object({}),
  effect: "external",
  confirm: "always",
  deadlineMs: 60_000,
  title: () => "Probe the staging server",
  run: async () => "probed",
});

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("Done.");
  if (said.includes("launch the probe")) return callTool("p1", "probe", {});
  if (said.includes("daily news")) return say("The build is green.");
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
const tray = () => env.client.call("notifications.list", {});

before(async () => {
  env = await startCore({ llm, extraTools: [probe] });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("an agent waiting for the owner's OK is in the tray until answered", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "launch the probe" });
  await waitFor(async () => (await tray()).notifications.some((n) => n.kind === "input"), "input noticed");
  const n = (await tray()).notifications.find((x) => x.kind === "input");
  assert.equal(n?.level, "warn");
  assert.equal(n?.thread_id, t.id);
  assert.match(n?.body ?? "", /Roby quiere usar probe/);

  // Opening the chat does not clear a pending question; answering it does.
  await env.client.call("threads.read", { thread: t.id });
  assert.equal((await tray()).unread, 1);
  await env.client.call("runs.respond", { input: n?.ref ?? "", decision: "approve" });
  await waitFor(async () => (await tray()).unread === 0, "answered question leaves the tray");
});

test("a task waiting for the owner, and a routine's news, until seen", async () => {
  const task = await env.client.call("tasks.create", { title: "Pick the launch date" });
  await env.client.call("tasks.update", { task: task.id, awaits_owner: true });
  assert.ok((await tray()).notifications.some((n) => n.kind === "task" && n.ref === task.id && !n.read_at));
  await env.client.call("tasks.update", { task: task.id, awaits_owner: true });
  assert.equal((await tray()).notifications.filter((n) => n.kind === "task").length, 1, "one notice per waiting task");
  // Seen, it stays seen while the task keeps moving; it comes back only if the task starts waiting again.
  await env.client.call("notifications.read", {});
  await env.client.call("tasks.comment", { task: task.id, text: "looking at it" });
  await env.client.call("tasks.update", { task: task.id, title: "Pick the launch date (Q4)" });
  assert.equal((await tray()).unread, 0);
  await env.client.call("tasks.update", { task: task.id, awaits_owner: false });
  await env.client.call("tasks.update", { task: task.id, awaits_owner: true });
  assert.equal((await tray()).unread, 1);
  await env.client.call("tasks.close", { task: task.id, state: "done" });
  assert.equal((await tray()).unread, 0);

  const r = await env.client.call("routines.set", {
    name: "Build report",
    agent: "roby",
    schedule: { kind: "manual" },
    prompt: "daily news",
  });
  const run = await env.client.call("routines.run", { routine: r.id });
  await waitFor(async () => (await tray()).notifications.some((n) => n.kind === "routine"), "routine noticed");
  const n = (await tray()).notifications.find((x) => x.kind === "routine");
  assert.equal(n?.title, "Build report");
  assert.match(n?.body ?? "", /build is green/);
  await env.client.call("threads.read", { thread: run.thread_id });
  assert.equal((await tray()).unread, 0, "opening its chat marks it seen");

  await env.client.call("routines.run", { routine: r.id });
  await waitFor(async () => (await tray()).unread === 1, "second run noticed");
  assert.equal((await env.client.call("notifications.read", {})).unread, 0);
});
