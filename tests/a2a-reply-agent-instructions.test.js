// An agent answering a peer must speak with its own instructions.
//
// The a2a reply system was assembled from the agent's frontmatter (Description,
// Role, Language), the etiquette and its memory — but never its BODY, the
// instructions written with `apx agent add --prompt` / the panel's "System
// prompt". So the same agent behaved differently depending on who asked: an
// agent whose body said a redesign was 70% done told a peer, over a2a, that
// nothing had started, while its own chat answered correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-instr-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
const { buildA2AReplySystem, replyAsAgent } = await import("#core/agent/a2a/reply.js");
const { buildAgentSystem } = await import("#core/agent/build-agent-system.js");

const BODY = "The billing revamp for northwind is 70% done; finishing Thursday.";
const toAgent = {
  slug: "tomas",
  fields: { Description: "Frontend lead", Model: "mock:echo" },
  body: BODY,
};
const fromAgent = { slug: "lucia", fields: {} };

test("the a2a reply system carries the agent's authored instructions", () => {
  const sys = buildA2AReplySystem({ toAgent, fromAgent, config: {} });
  assert.ok(sys.includes(BODY), "the body is in the a2a system prompt");
  assert.match(sys, /# Custom instructions/);
  // The etiquette still rides along.
  assert.match(sys, /agent-to-agent \(a2a\) message/);
});

test("a2a and a normal turn render the same instructions block", () => {
  const root = makeTempProject({ name: "northwind" });
  let normal;
  try {
    normal = buildAgentSystem({ id: 1, name: "northwind", path: root }, toAgent);
  } finally {
    cleanupTempProject(root);
  }
  const block = normal.split("\n\n").find((b) => b.startsWith("# Custom instructions"));
  assert.ok(block, "buildAgentSystem renders the block");
  assert.ok(buildA2AReplySystem({ toAgent, fromAgent, config: {} }).includes(block));
});

test("an agent with no body gets no empty instructions heading", () => {
  const sys = buildA2AReplySystem({ toAgent: { slug: "cfo", fields: {} }, fromAgent, config: {} });
  assert.doesNotMatch(sys, /# Custom instructions/);
});

test("the tool-loop path hands the instructions to the turn", async () => {
  const projectPath = makeTempProject({ name: "northwind" });
  let seen = null;
  try {
    await replyAsAgent({
      projectPath,
      toAgent,
      fromAgent,
      body: "how is the billing revamp going?",
      config: {},
      runAgentTurnFn: async ({ system }) => {
        seen = system;
        return { text: "ok", usage: null, model: "mock:echo", trace: [] };
      },
    });
  } finally {
    cleanupTempProject(projectPath);
  }
  assert.ok(seen?.includes(BODY), "runAgentTurn received the body in its system");
});
