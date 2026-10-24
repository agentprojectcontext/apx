import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`seen: ${String(req.messages.at(-1)?.content)}`);
  if (said.startsWith("search:")) return callTool("q1", "search_chats", { query: said.slice(7) });
  if (said.startsWith("read:")) return callTool("q2", "read_chat", { chat: said.slice(5) });
  if (said === "find participant") return callTool("p1", "search_chats", { query: "Roby dentist appointment" });
  if (said === "read participant") return callTool("p2", "read_chat", { chat: "Roby" });
  if (said === "ask colleague" && !afterTool) return callTool("p3", "delegate", { agent: "roby", task: "find it" });
  if (said.includes("find it")) return callTool("s1", "search_chats", { query: "dentist appointment" });
  if (said === "read it") return callTool("r1", "read_chat", { chat: "Errands" });
  if (said === "read nothing") return callTool("r2", "read_chat", { chat: "no such chat" });
  return say("noted");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Errands" });
  await env.client.call("threads.send", { thread: other.id, text: "my dentist appointment is on Friday at five" });
  await env.settle(other.id);
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const lastText = async () => {
  const t = await env.settle("home");
  return (
    t.messages
      .at(-1)
      ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("") ?? ""
  );
};

test("an agent finds what the owner said in another chat, as outside content, with the chat to read", async () => {
  await env.client.call("threads.send", { thread: "home", text: "find it" });
  const text = await lastText();
  assert.match(text, /<chats [^>]*trust="untrusted"/);
  assert.match(text, /\[Errands · chat [^\]]+\] .* Owner: .*dentist appointment/);
});

test("an agent reads another chat by its title, each message with who said it", async () => {
  await env.client.call("threads.send", { thread: "home", text: "read it" });
  const text = await lastText();
  assert.match(text, /<chat title="Errands"/);
  assert.match(text, /Owner: my dentist appointment is on Friday at five/);
  assert.match(text, /Roby: noted/);
});

test("a chat that does not exist lists the ones the agent can read", async () => {
  await env.client.call("threads.send", { thread: "home", text: "read nothing" });
  assert.match(await lastText(), /no chat named "no such chat"[\s\S]*Errands/);
});

test("a global specialist finds another agent's owner conversation by participant and topic", async () => {
  env.core.store.agents.upsert({
    id: "editor",
    name: "Editor",
    role: "editor",
    kind: "agent",
    browser_profile: "shared",
    source: "local",
    prompt: "",
  });
  const chat = await env.client.call("threads.create", {
    kind: "loose",
    title: "Conversation with Roby",
    agent_id: "editor",
  });
  await env.client.call("threads.send", { thread: chat.id, text: "find participant" });
  assert.match(
    (await env.settle(chat.id)).messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "",
    /Errands/,
  );
  await env.client.call("threads.send", { thread: chat.id, text: "read participant" });
  assert.match(
    (await env.settle(chat.id)).messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "",
    /id="home"/,
  );
});

test("a project specialist can ask the global agent to retrieve context through A2A", async () => {
  env.core.store.projects.upsert({ id: "team", name: "Team" });
  env.core.store.agents.upsert({
    id: "team-editor",
    name: "Team editor",
    role: "editor",
    kind: "agent",
    project_id: "team",
    browser_profile: "shared",
    source: "local",
    prompt: "",
  });
  const chat = env.core.store.threads.create({ kind: "loose", title: "Team review", agent_ids: ["team-editor"] });
  await env.client.call("threads.send", { thread: chat.id, text: "find participant" });
  assert.match(
    (await env.settle(chat.id)).messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "",
    /delegate/,
  );
  await env.client.call("threads.send", { thread: chat.id, text: "ask colleague" });
  const done = await env.settle(chat.id);
  assert.match(
    done.messages
      .at(-1)
      ?.parts.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? "",
    /dentist appointment/,
  );
  assert.equal(env.core.store.threads.sessions(chat.id)[0]?.agent_ids[0], "roby");
});

test("search scopes before ranking limits and excludes external clients, rooms and other projects", async () => {
  const store = env.core.store;
  const review = store.threads.create({ kind: "loose", title: "Search review", agent_ids: ["editor"] });
  const visible = store.threads.create({ kind: "loose", title: "Older owner chat", agent_ids: ["roby"] });
  store.threads.arrange(visible.id, { archived: true });
  store.messages.add({
    thread_id: visible.id,
    author: { kind: "user" },
    parts: [{ type: "text", text: "uniquecontext evidence" }],
  });
  for (let i = 0; i < 55; i++) {
    const hidden = store.threads.create({
      kind: "loose",
      title: `Private ${i}`,
      project_id: "team",
      agent_ids: ["team-editor"],
    });
    store.messages.add({
      thread_id: hidden.id,
      author: { kind: "user" },
      parts: [{ type: "text", text: "uniquecontext evidence" }],
    });
  }
  const client = store.threads.create({ kind: "loose", title: "External client", agent_ids: ["editor"] });
  store.threads.mergeContext(client.id, { client: "external" });
  const room = store.threads.create({ kind: "loose", title: "Room", agent_ids: ["roby"] });
  store.threads.mergeContext(room.id, { room: { name: "Room" } });
  for (const t of [client, room]) {
    store.messages.add({
      thread_id: t.id,
      author: { kind: "user" },
      parts: [{ type: "text", text: "uniquecontext evidence" }],
    });
    await env.client.call("threads.send", { thread: review.id, text: `read:${t.id}` });
    const done = await env.settle(review.id);
    assert.match(done.messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "", /no chat named/);
  }
  await env.client.call("threads.send", { thread: review.id, text: "search:uniquecontext evidence" });
  const done = await env.settle(review.id);
  const result = done.messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "";
  assert.match(result, /Older owner chat/);
  assert.doesNotMatch(result, /Private \d|External client|\[Contact|\[Room/);
});

test("participants retrieve their delegation by session name and by both participant names", async () => {
  const store = env.core.store;
  const parent = store.threads.create({ kind: "loose", title: "Review task", agent_ids: ["roby"] });
  const session = store.threads.create({
    kind: "a2a",
    title: "Delegated report",
    agent_ids: ["editor", "roby"],
    parent_id: parent.id,
    session: "release-report",
  });
  store.messages.add({
    thread_id: session.id,
    author: { kind: "agent", id: "editor" },
    parts: [{ type: "text", text: "releaseproof final report" }],
  });
  const unrelated = store.threads.create({ kind: "loose", title: "Unrelated report", agent_ids: ["roby"] });
  store.messages.add({
    thread_id: unrelated.id,
    author: { kind: "agent", id: "roby" },
    parts: [{ type: "text", text: "releaseproof unrelated" }],
  });
  const review = store.threads.create({ kind: "loose", title: "Review findings", agent_ids: ["editor"] });
  await env.client.call("threads.send", { thread: review.id, text: "read:release-report" });
  const read = await env.settle(review.id);
  assert.match(texts(read.messages).at(-1) ?? "", /releaseproof final report/);
  await env.client.call("threads.send", { thread: review.id, text: "search:Roby Editor releaseproof" });
  const searched = await env.settle(review.id);
  assert.match(texts(searched.messages).at(-1) ?? "", /Delegated report/);
  assert.doesNotMatch(texts(searched.messages).at(-1) ?? "", /Unrelated report/);
});

test("duplicate session names resolve within the caller's chat and refuse ambiguous global reads", async () => {
  const store = env.core.store;
  const parents = ["First caller", "Second caller"].map((title) =>
    store.threads.create({ kind: "loose", title, agent_ids: ["roby"] }),
  );
  for (const parent of parents) {
    const child = store.threads.create({
      kind: "a2a",
      title: `${parent.title} task`,
      agent_ids: ["editor", "roby"],
      parent_id: parent.id,
      session: "shared-name",
    });
    store.messages.add({
      thread_id: child.id,
      author: { kind: "agent", id: "editor" },
      parts: [{ type: "text", text: `${parent.title} final report` }],
    });
  }
  const first = parents[0];
  assert.ok(first);
  await env.client.call("threads.send", { thread: first.id, text: "read:shared-name" });
  const local = await env.settle(first.id);
  assert.match(texts(local.messages).at(-1) ?? "", /First caller final report/);
  assert.doesNotMatch(texts(local.messages).at(-1) ?? "", /Second caller final report/);
  const other = store.threads.create({ kind: "loose", title: "Other caller", agent_ids: ["editor"] });
  await env.client.call("threads.send", { thread: other.id, text: "read:shared-name" });
  const ambiguous = await env.settle(other.id);
  assert.match(texts(ambiguous.messages).at(-1) ?? "", /Ambiguous session name/);
});

test("a longer participant name does not also require an unrelated agent with its shorter name", async () => {
  const store = env.core.store;
  const parent = store.threads.create({
    kind: "loose",
    title: "Team handoff",
    project_id: "team",
    agent_ids: ["roby"],
  });
  const session = store.threads.create({
    kind: "a2a",
    title: "Team delegated findings",
    project_id: "team",
    parent_id: parent.id,
    agent_ids: ["team-editor", "roby"],
  });
  store.messages.add({
    thread_id: session.id,
    author: { kind: "agent", id: "team-editor" },
    parts: [{ type: "text", text: "specificproof final report" }],
  });
  const review = store.threads.create({
    kind: "loose",
    title: "Team findings review",
    project_id: "team",
    agent_ids: ["team-editor"],
  });
  await env.client.call("threads.send", {
    thread: review.id,
    text: "search:Team editor Roby specificproof",
  });
  const done = await env.settle(review.id);
  assert.match(texts(done.messages).at(-1) ?? "", /Team delegated findings/);
});

test("search finds what an agent did in its own runs, by tool and arguments, and only in chats it can read", async () => {
  const store = env.core.store;
  const step = (threadId: string, agentId: string, postId: string) => {
    const run = store.runs.create({
      thread_id: threadId,
      agent_id: agentId,
      trigger: "routine",
      input: { origin: { kind: "routine", id: "rtn_board", name: "Board check" }, text: "check" },
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    store.runs.setState(run, "completed");
    store.runs.beginStep(run.id, {
      call_id: "c1",
      tool: "mcp_board_create_comment",
      args: { post_id: postId, content: "a reply about retries" },
      effect: "external",
    });
    store.runs.endStep(run.id, "c1", "ok", "Comment added");
  };
  const routine = store.threads.create({ kind: "loose", title: "Board check", agent_ids: ["roby"] });
  step(routine.id, "roby", "post-4f1a");
  const hidden = store.threads.create({
    kind: "loose",
    title: "Team board check",
    project_id: "team",
    agent_ids: ["team-editor"],
  });
  step(hidden.id, "team-editor", "post-9c2b");

  // A global specialist, not the secretary: it must not see the project team's chat.
  const chat = store.threads.create({ kind: "loose", title: "Board audit", agent_ids: ["editor"] });
  await env.client.call("threads.send", { thread: chat.id, text: "search:create_comment post" });
  const text = (await env.settle(chat.id)).messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "";
  assert.match(
    text,
    /Tool calls:\n- \[Board check · chat [^\]]+\] .* Roby called mcp_board_create_comment .*post-4f1a.* → Comment added/,
  );
  assert.doesNotMatch(text, /post-9c2b/);
});

test("read_chat expands an old message beyond the latest page and honors forgotten evidence", async () => {
  let chat = "",
    anchor = "";
  const model = scriptedLlm((req, { afterTool }) =>
    afterTool
      ? say(String(req.messages.at(-1)?.content))
      : callTool("old", "read_chat", { chat, around: anchor, limit: 4 }),
  );
  const isolated = await startCore({ llm: model });
  try {
    const source = await isolated.client.call("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "Old archive",
    });
    chat = source.id;
    const fact = "Acme archived invoices use violet labels.";
    anchor = isolated.core.store.messages.add({
      thread_id: source.id,
      author: { kind: "user" },
      parts: [{ type: "text", text: fact }],
    }).id;
    for (let i = 0; i < 80; i++)
      isolated.core.store.messages.add({
        thread_id: source.id,
        author: { kind: "user" },
        parts: [{ type: "text", text: `Later unrelated message ${i}.` }],
      });
    assert.equal(
      isolated.core.store.messages.list(source.id, 20).some((m) => m.id === anchor),
      false,
    );
    const ask = async () => {
      const current = await isolated.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      await isolated.client.call("threads.send", { thread: current.id, text: "Read the old archive anchor." });
      await isolated.settle(current.id);
      return texts((await isolated.client.call("threads.get", { thread: current.id })).messages).join("\n");
    };
    assert.match(await ask(), /violet labels/);
    const note = isolated.core.store.memories.add({
      scope: "agent",
      agent_id: "roby",
      source: "agent",
      text: fact,
      evidence: [{ message_id: anchor, quote: fact }],
    });
    await isolated.client.call("memory.remove", { id: note.id });
    assert.doesNotMatch(await ask(), /violet labels/);
  } finally {
    await isolated.core.close();
    await isolated.cleanup();
  }
});

test("search reaches this chat's own earlier steps outside the model's view, without repeating the visible window", async () => {
  const model = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    if (said === "how did snapinsta work") return callTool("h1", "search_chats", { query: "snapinsta" });
    return say("noted");
  });
  const isolated = await startCore({ llm: model });
  try {
    const store = isolated.core.store;
    // A run of this same chat whose model history is gone from the projection (older than the window).
    const old = store.runs.create({
      thread_id: "home",
      agent_id: "roby",
      trigger: "user",
      input: { origin: { kind: "user" }, text: "download this reel" },
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    store.runs.setState(old, "completed");
    store.runs.beginStep(old.id, {
      call_id: "o1",
      tool: "browser_open",
      args: { url: "https://snapinsta.example.com/reel" },
      effect: "none",
    });
    store.runs.endStep(old.id, "o1", "ok", "Page opened");
    // A turn still in view: its words and its own search must not come back as found.
    await isolated.client.call("threads.send", { thread: "home", text: "how did snapinsta work" });
    await isolated.settle("home");
    await isolated.client.call("threads.send", { thread: "home", text: "how did snapinsta work" });
    const text = texts((await isolated.settle("home")).messages).at(-1) ?? "";
    assert.match(text, /\[Home · chat home\] .* Roby called browser_open .*snapinsta\.example\.com.* → Page opened/);
    assert.doesNotMatch(text, /called search_chats/, "steps of visible runs are already in context");
    assert.doesNotMatch(text, /Owner: how did snapinsta work/, "messages of visible runs are already in context");
  } finally {
    await isolated.core.close();
    await isolated.cleanup();
  }
});
