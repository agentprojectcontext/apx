import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said }) => {
  if (said.includes("explode")) throw new Error("engine down");
  return say("The report is ready.");
});

let env: Awaited<ReturnType<typeof startCore>>;
const UNSEEN_MS = 300;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const runNotices = async (thread: string) =>
  (await env.client.call("notifications.list", {})).notifications.filter(
    (n) => n.kind === "run" && n.thread_id === thread,
  );

/** A stand-in Expo push service: what the core pushed to phones. */
const pushes: Array<Record<string, unknown>> = [];
const expo = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    pushes.push(JSON.parse(raw) as Record<string, unknown>);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});

before(async () => {
  await new Promise<void>((r) => expo.listen(0, "127.0.0.1", r));
  env = await startCore({
    llm,
    unseenAfterMs: UNSEEN_MS,
    expoPushUrl: `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push`,
  });
  const { device } = env.core.store.devices.create("Phone", "android");
  env.core.store.devices.setPush(device.id, { kind: "expo", token: "ExponentPushToken[test]" });
});
after(async () => {
  await env.core.close();
  await new Promise<void>((r) => expo.close(() => r()));
  await env.cleanup();
});

async function turn(text: string) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text });
  await env.settle(t.id);
  return t.id;
}

test("a turn that ends while nobody looks at its chat reaches the tray, once per chat", async () => {
  const thread = await turn("write the report");
  await wait(UNSEEN_MS * 2);
  const [n, ...more] = await runNotices(thread);
  assert.equal(n?.level, "info");
  assert.equal(n?.title, "Roby");
  assert.match(n?.body ?? "", /report is ready/);
  assert.equal(more.length, 0);
  // The phone hears of it too, with the chat to open.
  const sent = pushes.find((p) => (p.data as Record<string, string> | undefined)?.thread_id === thread);
  assert.equal(sent?.to, "ExponentPushToken[test]");
  assert.match(String(sent?.body), /report is ready/);
  // A second turn in the same unread chat replaces the notice rather than piling up.
  await env.client.call("threads.send", { thread, text: "again" });
  await env.settle(thread);
  await wait(UNSEEN_MS * 2);
  assert.equal((await runNotices(thread)).filter((x) => !x.read_at).length, 1);
  // Opening the chat clears it.
  await env.client.call("threads.read", { thread });
  assert.ok((await runNotices(thread)).every((x) => x.read_at));
});

test("a turn the owner was watching raises nothing", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "write the report" });
  await env.settle(t.id);
  await env.client.call("threads.read", { thread: t.id });
  await wait(UNSEEN_MS * 2);
  assert.equal((await runNotices(t.id)).length, 0);
  assert.ok(!pushes.some((p) => (p.data as Record<string, string> | undefined)?.thread_id === t.id));
});

test("a failed turn is an error notice with the reason, and leaves its chat unread", async () => {
  const thread = await turn("explode");
  assert.ok((await env.client.call("threads.get", { thread })).thread.unread > 0);
  await wait(UNSEEN_MS * 2);
  const [n] = await runNotices(thread);
  assert.equal(n?.level, "error");
  assert.match(n?.body ?? "", /engine down|No model could answer|Could not finish/);
});

test("a turn with work still coming back to its chat waits for the last one to tell the owner", async () => {
  const { store } = env.core;
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  // A background command the agent started: its end wakes the agent in this chat.
  const job = store.jobs.create({ thread_id: t.id, agent_id: "roby", title: "pnpm test", cwd: ".", background: true });
  await env.client.call("threads.send", { thread: t.id, text: "write the report" });
  await env.settle(t.id);
  await wait(UNSEEN_MS * 2);
  assert.equal((await runNotices(t.id)).length, 0, "no notice while the job runs");
  store.jobs.finish(job.id, "completed", 0);
  await env.client.call("threads.send", { thread: t.id, text: "again" });
  await env.settle(t.id);
  await wait(UNSEEN_MS * 2);
  assert.equal((await runNotices(t.id)).length, 1, "the turn that ends the work tells it once");
});
