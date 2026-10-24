import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const worker = { name: "Researcher", instructions: "Check every source and list it." };
let project = "";

const llm = scriptedLlm(async (_req, { system, said, afterTool }) => {
  if (system.startsWith("You are Researcher")) return say("Two sources, both fresh.");
  if (said.includes("<delegation_result")) return say("The researcher is back.");
  if (said.includes("ask a worker in the project") && !afterTool)
    return callTool("d1", "delegate", { worker, task: "check the sources", project });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  project = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a chat's delegated chats come with it, a few per chat, with how many there are", async () => {
  const repo = env.core.store.threads;
  const root = repo.create({ kind: "agent", title: "Root", agent_ids: ["roby"], at: "2020-01-01T00:00:00Z" });
  const subs = [0, 1, 2, 3].map((i) =>
    repo.create({
      kind: "a2a",
      title: `Sub ${i}`,
      agent_ids: ["roby"],
      parent_id: root.id,
      at: `2020-01-0${i + 2}T00:00:00Z`,
    }),
  );
  const gone = repo.create({ kind: "a2a", title: "Gone", agent_ids: ["roby"], parent_id: root.id });
  repo.arrange(gone.id, { archived: true });

  const plain = await env.client.call("threads.list", {});
  assert.equal(
    plain.threads.some((t) => t.parent_id === root.id),
    false,
    "without `delegated` nothing changes",
  );
  assert.equal(plain.delegated, undefined);

  const listed = await env.client.call("threads.list", { delegated: 2 });
  const nested = listed.threads.filter((t) => t.parent_id === root.id).map((t) => t.title);
  assert.deepEqual(nested, ["Sub 3", "Sub 2"], "the newest two, archived ones left out");
  assert.equal(listed.delegated?.[root.id], 4);
  assert.ok(subs[0] && !listed.threads.some((t) => t.id === subs[0]?.id));
});

test("a chat delegated into a project from a chat outside it is listed in that project, still under its caller", async () => {
  const home = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Home" });
  await env.client.call("threads.send", { thread: home.id, text: "ask a worker in the project" });
  await env.settle(home.id);

  const inProject = await env.client.call("threads.list", { project_id: project, delegated: 5 });
  const sub = inProject.threads.find((t) => t.parent_id === home.id);
  assert.ok(sub, "the delegated chat shows in its project");
  assert.equal(sub.project_id, project);
  assert.equal(sub.kind, "a2a");
  assert.equal(
    inProject.threads.some((t) => t.id === home.id),
    false,
    "the caller stays where it is",
  );

  const all = await env.client.call("threads.list", { delegated: 5 });
  assert.equal(all.threads.filter((t) => t.id === sub.id).length, 1, "listed once");
  assert.equal(all.delegated?.[home.id], 1);

  // Its answer went back to the caller's card: only the caller has something unread.
  const got = await env.client.call("threads.get", { thread: home.id });
  assert.equal(got.thread.unread, 1);
  assert.equal((await env.client.call("threads.get", { thread: sub.id })).thread.unread, 0);
});
