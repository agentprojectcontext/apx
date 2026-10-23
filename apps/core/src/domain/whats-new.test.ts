import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import type { Release, ReleaseSource } from "../release-notes.ts";

const RELEASES: Release[] = [
  {
    version: "2.3.33",
    previous: "2.3.32",
    changes: [
      { kind: "feat", text: "A widget opens in the browser from its header", sha: "aaa1111" },
      { kind: "fix", text: "A chat turn gets 60 steps", sha: "bbb2222" },
    ],
  },
  {
    version: "2.3.32",
    previous: "2.3.31",
    changes: [{ kind: "fix", text: "Shell reads a read-only folder freely", sha: "ccc3333" }],
  },
  { version: "2.3.31", previous: "2.3.30", changes: [] },
];

/** A build of `version` carrying the notes up to it, as stage.ts writes them. */
const release = (version: string): ReleaseSource => ({
  version: () => version,
  notes: () => ({
    version,
    branch: "release/v2",
    releases: RELEASES.filter((r) => r.version <= version),
  }),
});

const told = async (client: { call: (m: "threads.list", p: object) => Promise<{ threads: Thread[] }> }) =>
  (await client.call("threads.list", {})).threads.filter((t) => t.release);

test("a new install starts quiet; the next release is told once, unread, with no model call", async () => {
  const llm = scriptedLlm(() => say("It is in the Inbox now"));
  const first = await startCore({ llm, releases: release("2.3.32") });
  assert.deepEqual(await told(first.client), []);
  await first.core.close();

  const second = await startCore({ llm, home: first.home, releases: release("2.3.33") });
  await second.core.close();
  const third = await startCore({ llm, home: first.home, releases: release("2.3.33") });
  try {
    const threads = await told(third.client);
    assert.equal(threads.length, 1, "one chat per release, across restarts");
    const [thread] = threads;
    assert.ok(thread);
    assert.equal(thread.release, "2.3.33");
    assert.equal(thread.unread, 1);
    assert.equal(thread.title, "What's new in APX 2.3.33", "English whatever the owner speaks: the notes are");
    assert.deepEqual(thread.agent_ids, ["roby"]);
    const { messages } = await third.client.call("threads.get", { thread: thread.id });
    const text = JSON.stringify(messages[0]?.parts);
    assert.deepEqual(messages[0]?.author, { kind: "agent", id: "roby" });
    assert.match(text, /APX was updated to 2\.3\.33/);
    assert.match(text, /\*\*New\*\*\\n- A widget opens in the browser from its header/);
    assert.match(text, /\*\*Fixed\*\*\\n- A chat turn gets 60 steps/);
    assert.doesNotMatch(text, /read-only folder/, "only what is new since the release the install was on");
    assert.equal(llm.calls.length, 0, "telling costs no tokens");

    // Asked about it, the agent's input names the release, its branch and its commits; the system prompt does not.
    await third.client.call("threads.send", { thread: thread.id, text: "¿Qué cambió en los widgets?" });
    await third.settle(thread.id);
    const call = llm.calls.at(-1);
    const input = JSON.stringify(call?.messages.at(-1));
    assert.match(input, /\[release notes\] You posted here what APX's update to 2\.3\.33 changed/);
    assert.match(input, /built from branch release\/v2/);
    assert.match(input, /compare\/v2\.3\.32\.\.\.v2\.3\.33/);
    const system = call?.messages.filter((m) => m.role === "system") ?? [];
    assert.ok(system.length);
    assert.doesNotMatch(JSON.stringify(system), /release notes|2\.3\.33/, "the system prompt stays byte-stable");
    const history = JSON.stringify(call?.messages);
    assert.match(history, /A chat turn gets 60 steps/, "the model reads the notes as what it said");
  } finally {
    await third.core.close();
    third.cleanup();
  }
});

test("an install that skipped releases is told each one; going back and up again tells nothing twice", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const first = await startCore({ llm, releases: release("2.3.30") });
  await first.core.close();
  const second = await startCore({ llm, home: first.home, releases: release("2.3.33") });
  await second.core.close();
  const older = await startCore({ llm, home: first.home, releases: release("2.3.32") });
  await older.core.close();
  const again = await startCore({ llm, home: first.home, releases: release("2.3.33") });
  try {
    const threads = await told(again.client);
    assert.equal(threads.length, 1);
    const { messages } = await again.client.call("threads.get", { thread: threads[0]?.id ?? "" });
    const text = JSON.stringify(messages[0]?.parts);
    assert.match(text, /### 2\.3\.33.*### 2\.3\.32.*read-only folder.*### 2\.3\.31\\n\\nInternal changes only/);
    const ctx = again.core.store.threads.context(threads[0]?.id ?? "");
    assert.equal(ctx.release?.previous, "2.3.30", "its commits run from the release the install was on");
  } finally {
    await again.core.close();
    again.cleanup();
  }
});

test("an install in use before release notes existed is told the release it starts on", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const first = await startCore({ llm });
  await first.client.call("threads.send", { thread: "home", text: "hello" });
  await first.settle("home");
  await first.core.close();
  const second = await startCore({ llm, home: first.home, releases: release("2.3.33") });
  try {
    const threads = await told(second.client);
    assert.deepEqual(
      threads.map((t) => t.release),
      ["2.3.33"],
    );
    const { messages } = await second.client.call("threads.get", { thread: threads[0]?.id ?? "" });
    const text = JSON.stringify(messages[0]?.parts);
    assert.match(text, /A chat turn gets 60 steps/);
    assert.doesNotMatch(text, /read-only folder|### 2\.3\.3[12]/, "older releases are not told");
    const ctx = second.core.store.threads.context(threads[0]?.id ?? "");
    assert.equal(ctx.release?.previous, "2.3.32", "its commits run from the release before");
  } finally {
    await second.core.close();
    second.cleanup();
  }
});

test("each new release goes on in the same news chat, retitled, instead of opening another", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const first = await startCore({ llm, releases: release("2.3.31") });
  await first.client.call("threads.send", { thread: "home", text: "hello" });
  await first.settle("home");
  await first.core.close();
  const second = await startCore({ llm, home: first.home, releases: release("2.3.32") });
  await second.core.close();
  const third = await startCore({ llm, home: first.home, releases: release("2.3.33") });
  try {
    const threads = await told(third.client);
    assert.equal(threads.length, 1, "one chat for the news");
    assert.equal(threads[0]?.title, "What's new in APX 2.3.33");
    assert.equal(threads[0]?.release, "2.3.33");
    assert.equal(threads[0]?.unread, 2, "both releases unread");
    const { messages } = await third.client.call("threads.get", { thread: threads[0]?.id ?? "" });
    const said = messages.map((m) => JSON.stringify(m.parts));
    assert.ok(said.some((t) => /updated to 2\.3\.32/.test(t)) && said.some((t) => /updated to 2\.3\.33/.test(t)));
  } finally {
    await third.core.close();
    third.cleanup();
  }
});
