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
  assert.equal(filed.length, 1);
  assert.equal(filed[0].body, "Algo que falla.");
  assert.equal(filed[0].author, SUPERAGENT_ACTOR_ID);
  cleanupTempProject(p.path);
});
