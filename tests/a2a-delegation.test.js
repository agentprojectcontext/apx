// The super-agent handing work to a project agent.
//
// The regression this file guards cost a day and was invisible while it cost
// it. `call_agent` was one model call with NO tool loop, logged to a channel
// called "engine" that is not in CHANNELS and that no surface lists. So an
// agent asked to read a repo and open a task answered "I'm on it. Let me start
// by pulling the recent repo activity" followed by `<tool_call>
// <function=git_log>` as literal text — a model with no tools describing the
// tools it did not have — and that text came back as the tool's result. The
// owner read a confident reply and had no way to learn that nothing happened
// and nowhere to go looking.
//
// Delegation is a conversation between two agents, so it goes where those live.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-delegation-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { delegateToAgent } = await import("#core/agent/a2a/delegate.js");
const { listProjectA2AThreads, readProjectMessages, a2aThreadId } =
  await import("#core/stores/messages.js");
const { appendMessageToFs } = await import("#core/stores/messages.js");
const { SUPERAGENT_ACTOR_ID } = await import("#core/constants/actors.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const AGENT = { slug: "jaro", name: "Jaro", fields: { Name: "Jaro" } };

/** A project shaped the way the daemon hands one to a tool handler. */
function project() {
  const root = makeTempProject({ name: "northwind", agents: [{ slug: "jaro" }] });
  const storagePath = path.join(TMP_HOME, "storage", path.basename(root));
  fs.mkdirSync(storagePath, { recursive: true });
  return {
    id: 7,
    path: root,
    storagePath,
    config: {},
    logMessage: (payload) => appendMessageToFs({ projectRoot: storagePath, ...payload }),
  };
}

const rows = (p) => readProjectMessages(p.storagePath, { channel: "a2a", limit: 100 });

test("a delegation is filed as an a2a conversation, both halves", async () => {
  const p = project();
  const seen = [];
  const out = await delegateToAgent({
    project: p,
    agent: AGENT,
    prompt: "Revisá el módulo de carwash y abrí la task.",
    config: {},
    replyFn: async (args) => {
      seen.push(args);
      return { text: "Listo: leí el repo y abrí la task.", usage: { input_tokens: 10 }, model: "test:model" };
    },
  });

  // Where it lives, so the caller can say so instead of the owner going hunting.
  assert.equal(out.thread, a2aThreadId(SUPERAGENT_ACTOR_ID, "jaro"));
  assert.equal(out.channel, "a2a");
  assert.equal(out.text, "Listo: leí el repo y abrí la task.");

  const threads = listProjectA2AThreads(p.storagePath);
  assert.equal(threads.length, 1, "one conversation, not two monologues");
  assert.deepEqual(threads[0].participants.sort(), [SUPERAGENT_ACTOR_ID, "jaro"].sort());
  assert.equal(threads[0].id, out.thread);

  // Nothing goes to the channel that no surface lists.
  const engine = readProjectMessages(p.storagePath, { channel: "engine", limit: 50 });
  assert.equal(engine.length, 0, "`engine` is not a channel (constants/channels.js)");
  cleanupTempProject(p.path);
});

test("the delegated agent gets its tools — that is the whole point", async () => {
  const p = project();
  let got = null;
  await delegateToAgent({
    project: p,
    agent: AGENT,
    prompt: "Abrí la task.",
    config: {},
    replyFn: async (args) => { got = args; return { text: "ok" }; },
  });
  // Without this the agent can only DESCRIBE the work, and its description
  // comes back looking exactly like the work.
  assert.equal(got.tools, true);
  assert.equal(got.toAgent.slug, "jaro");
  assert.equal(got.peerAddress, SUPERAGENT_ACTOR_ID);
  assert.equal(got.projectPath, p.path, "a real path on disk, or replyAsAgent drops the tool loop");
  cleanupTempProject(p.path);
});

test("a second delegation carries what the first one said", async () => {
  const p = project();
  const ask = (prompt, reply) =>
    delegateToAgent({
      project: p, agent: AGENT, prompt, config: {},
      replyFn: async (args) => { p._lastHistory = args.history; return { text: reply }; },
    });

  await ask("Revisá el repo.", "Revisado: falta el alta con CUIT duplicado.");
  assert.deepEqual(p._lastHistory, [], "the first one starts clean");

  await ask("¿Y la task?", "Abierta.");
  // Without this the agent forgets the previous turn, which from the thread
  // reads as an agent that was told something and ignored it.
  const bodies = p._lastHistory.map((m) => m.content);
  assert.equal(p._lastHistory.length, 2);
  assert.match(bodies[0], /Revisá el repo/);
  assert.match(bodies[1], /falta el alta con CUIT duplicado/);
  assert.deepEqual(p._lastHistory.map((m) => m.role), ["user", "assistant"]);
  cleanupTempProject(p.path);
});

test("the instruction reaches the agent before its own answer does", async () => {
  // The inbound row is written BEFORE the reply runs, so a delegation that
  // times out or throws still leaves the ask on the thread — otherwise the one
  // case worth reading back is the one that records nothing.
  const p = project();
  await assert.rejects(
    delegateToAgent({
      project: p, agent: AGENT, prompt: "Algo que falla.", config: {},
      replyFn: async () => { throw new Error("engine down"); },
    }),
    /engine down/,
  );
  const filed = rows(p);
  assert.equal(filed.length, 3, "inbound plus both halves of the failure reply");
  const ask = filed.find((r) => r.body === "Algo que falla.");
  const reply = filed.find((r) => r.direction === "out" && r.author === "jaro");
  assert.equal(ask.author, SUPERAGENT_ACTOR_ID);
  assert.match(reply.body, /did not answer: engine down/);
  assert.equal(reply.meta.failed, true);
  cleanupTempProject(p.path);
});

test("a dead peer still files the tools it already ran", async () => {
  const p = project();
  await assert.rejects(
    delegateToAgent({
      project: p, agent: AGENT, prompt: "Renombrá.", config: {},
      replyFn: async ({ onEvent }) => {
        await onEvent({ type: "tool_result", trace: { tool: "rename_agent", result: { ok: true } } });
        throw new Error("ollama 400");
      },
    }),
    /ollama 400/,
  );
  const reply = rows(p).find((r) => r.direction === "out" && r.author === "jaro");
  assert.ok(reply, "the failure reply is on the thread");
  assert.match(reply.body, /did not answer: ollama 400/);
  assert.equal(reply.meta.failed, true);
  assert.equal(reply.meta.trace[0].tool, "rename_agent");
  cleanupTempProject(p.path);
});

// A project agent delegating is filed as ITSELF. `delegateToAgent` defaulted
// `from` to the super-agent and `call_agent` never passed one, so when Kai
// asked Bridget something the thread said super_agent → bridget, Bridget
// answered "Hola Roby", and the owner read a conversation that never happened.
test("a delegation made by a project agent is filed under that agent", async () => {
  const p = project();
  let seen = null;
  const out = await delegateToAgent({
    project: p, agent: AGENT, prompt: "Pasame el brief.", config: {},
    from: "kai", depth: 2,
    replyFn: async (args) => { seen = args; return { text: "Va.", model: "test:model" }; },
  });
  assert.equal(out.thread, a2aThreadId("kai", "jaro"));
  const inbound = rows(p).find((r) => r.direction === "in" && r.agent_slug === "jaro");
  assert.equal(inbound.author, "kai");
  assert.equal(inbound.meta.from, "kai");
  // The recipient is told who is really asking…
  assert.equal(seen.peerAddress, "kai");
  assert.equal(seen.fromAgent.slug, "kai");
  // …and its own hand-offs keep counting the chain instead of restarting it.
  assert.equal(seen.depth, 2);
  cleanupTempProject(p.path);
});

test("call_agent takes its sender and depth from the running turn", async () => {
  const { default: callAgent } = await import("#core/agent/tools/handlers/call-agent.js");
  const p = project();
  const projects = { get: () => p, list: () => [{ id: p.id, name: "northwind", path: p.path }], current: () => p };
  // Calling yourself is refused before anything is filed.
  const asJaro = callAgent.makeHandler({ projects, globalConfig: {}, channelMeta: { agentSlug: "jaro" } });
  await assert.rejects(asJaro({ agent: "jaro", prompt: "hola" }), /that is you/);
  // A chain that is already at the wall gets an answer, not another hop.
  const deep = callAgent.makeHandler({ projects, globalConfig: {}, channelMeta: { agentSlug: "kai", a2aDepth: 2 } });
  const out = await deep({ agent: "jaro", prompt: "Revisá esto." });
  assert.match(out.error, /depth limit/);
  assert.equal(rows(p).length, 0, "nothing filed for a refused hop");
  cleanupTempProject(p.path);
});

// Review of the spend breaker: a delegation the owner is WAITING on from a live
// chat ran as `a2a` and was paused like background work — "your own chats are
// not affected" was false for the one request the owner had just made.
test("a delegation the owner waits on is marked watched; a background one is not", async () => {
  const p = project();
  const seen = [];
  const replyFn = async (args) => { seen.push(args.watched); return { text: "ok" }; };
  await delegateToAgent({ project: p, agent: AGENT, prompt: "x", config: {}, watched: true, replyFn });
  await delegateToAgent({ project: p, agent: AGENT, prompt: "x", config: {}, replyFn });
  assert.deepEqual(seen, [true, false]);
  cleanupTempProject(p.path);
});

test("call_agent from a watched chat delegates watched; from a routine it does not", async () => {
  const { isUnwatchedTurn } = await import("#core/agent/quota.js");
  const { CHANNELS } = await import("#core/constants/channels.js");
  assert.equal(isUnwatchedTurn(CHANNELS.TELEGRAM, {}), false);
  assert.equal(isUnwatchedTurn(CHANNELS.ROUTINE, {}), true);
  assert.equal(isUnwatchedTurn(CHANNELS.A2A, { unwatched: false }), false, "a watched delegation");
  assert.equal(isUnwatchedTurn(CHANNELS.WEB, { unwatched: true }), true, "an agent-started task comment");
  const src = fs.readFileSync(new URL("../src/core/agent/tools/handlers/call-agent.js", import.meta.url), "utf8");
  assert.match(src, /watched: !isUnwatchedTurn\(channel, channelMeta\)/);
});
