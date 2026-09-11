// An agent talking to another agent, as a TOOL.
//
// There wasn't one. `call_agent` resolves its target with `readAgents(project)`,
// so it can only reach a PROJECT agent — an agent that wanted to reach the
// super-agent had no tool at all. What that produced, on a real turn: Ansel
// finished its analysis, needed to tell Roby, and shelled out —
//
//   run_shell: cd /…/knot && apx send orchestrator default "…" --deliver
//
// `--deliver` blocks. Ansel sat frozen for the ten minutes the super-agent took
// to answer, and from every surface both of them looked dead.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-tool-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { messagePeer } = await import("#core/agent/a2a/delegate.js");
const { TOOL_SCHEMAS, BASE_TOOL_NAMES } = await import("#core/agent/tools/registry.js");
const { TOOLS } = await import("#core/agent/tools/names.js");
const { defaultAgentToolNames } = await import("#core/agent/agent-tools.js");
const { listProjectA2AThreads, appendMessageToFs, a2aThreadId } =
  await import("#core/stores/messages.js");
const { SUPERAGENT_ACTOR_ID } = await import("#core/constants/actors.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

function project() {
  const root = makeTempProject({ name: "northwind", agents: [{ slug: "ansel" }, { slug: "jaro" }] });
  const storagePath = path.join(TMP_HOME, "storage", path.basename(root));
  fs.mkdirSync(storagePath, { recursive: true });
  return {
    id: 7, path: root, storagePath, name: "northwind", config: {},
    logMessage: (payload) => appendMessageToFs({ projectRoot: storagePath, ...payload }),
  };
}

test("the tool exists, and every agent has it without going looking", () => {
  const schema = TOOL_SCHEMAS.find((t) => t.function.name === "send_to_agent");
  assert.ok(schema, "send_to_agent must be in the registry");
  assert.deepEqual(schema.function.parameters.required.sort(), ["message", "to"]);
  // Base, not on-demand: an agent that has to discover this tool does not
  // discover it — it shells out to `apx send`, which blocks its whole turn.
  assert.ok(BASE_TOOL_NAMES.has(TOOLS.SEND_TO_AGENT), "must be in the base set");
  // And a project agent may call it — that is the whole point.
  assert.ok(defaultAgentToolNames().includes(TOOLS.SEND_TO_AGENT));
});

test("a project agent can reach the SUPER-AGENT, which call_agent cannot", () => {
  // `call_agent` looks its target up in the project roster, so `default` /
  // super_agent is unreachable through it. That gap is the reason the shell
  // command existed.
  const callAgent = TOOL_SCHEMAS.find((t) => t.function.name === "call_agent");
  assert.match(callAgent.function.parameters.properties.agent.description, /slug/);
  const send = TOOL_SCHEMAS.find((t) => t.function.name === "send_to_agent");
  assert.match(send.function.parameters.properties.to.description, /super-agent/i);
  assert.match(send.function.description, /apx send/, "it has to say not to shell out");
});

test("a message files one a2a thread with both peers on it", async () => {
  const p = project();
  const out = await messagePeer({
    project: p,
    to: "jaro",
    from: "ansel",
    body: "Necesito el brief de carwash.",
    config: {},
    replyFn: async () => ({ text: "Va.", model: "test:model" }),
  });
  assert.equal(out.thread, a2aThreadId("ansel", "jaro"));
  assert.equal(out.channel, "a2a");
  const threads = listProjectA2AThreads(p.storagePath);
  assert.equal(threads.length, 1);
  assert.deepEqual(threads[0].participants.sort(), ["ansel", "jaro"]);
  cleanupTempProject(p.path);
});

test("the sender is who is RUNNING, never an argument", async () => {
  // The thread is the owner's record of who said what. A sender the caller can
  // choose is a sender the caller can forge, so it comes from the turn's own
  // context (channelMeta.agentSlug) and there is no parameter for it.
  const schema = TOOL_SCHEMAS.find((t) => t.function.name === "send_to_agent");
  assert.ok(!("from" in schema.function.parameters.properties), "no `from` parameter");
  const src = fs.readFileSync(
    new URL("../src/core/agent/tools/handlers/send-to-agent.js", import.meta.url),
    "utf8",
  );
  assert.match(src, /channelMeta\?\.agentSlug \|\| SUPERAGENT_ACTOR_ID/);
});

test("writing to yourself is refused, not filed as a conversation", async () => {
  const p = project();
  await assert.rejects(
    messagePeer({
      project: p, to: "nobody-here", from: "ansel", body: "hola", config: {},
      replyFn: async () => ({ text: "x" }),
    }),
    /no peer named nobody-here/,
  );
  cleanupTempProject(p.path);
});

test("the peer is resolved, so the super-agent is a valid address", async () => {
  const p = project();
  let got = null;
  await messagePeer({
    project: p,
    to: SUPERAGENT_ACTOR_ID,
    from: "ansel",
    body: "Knot status: ya tengo el panorama.",
    config: {},
    replyFn: async (args) => { got = args; return { text: "Recibido." }; },
  });
  assert.equal(got.peer.kind, "super_agent", "this is the address call_agent could not reach");
  assert.equal(got.fromAddress, "ansel");
  cleanupTempProject(p.path);
});
