import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AGENT_NAMES } from "@apx/protocol";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";

// Each owner message names the tool call the scripted model makes; the tool's result comes back as the answer.
const CALLS: Record<string, [string, object]> = {
  "show me Acme Writer": ["agent_set", { agent: "Acme Writer" }],
  "hire a researcher": ["agent_set", { slug: "researcher", name: "Researcher", role: "Finds sources" }],
  "hire a sentry": ["agent_set", { slug: "sentry", name: "Sentry" }],
  "hire a triager": ["agent_set", { slug: "issue-triage", role: "Issue triage" }],
  "hire a wordy one": [
    "agent_set",
    { slug: "wordy", role: "APX GitHub issue triage: validate reports, classify and label issues, assign owners" },
  ],
  "hire a tester for northwind": ["agent_set", { slug: "tester", name: "Tester", project: "northwind" }],
  "hire one for nowhere": ["agent_set", { slug: "lost", name: "Lost", project: "Nowhere" }],
  "rename the writer": ["agent_set", { agent: "acme-writer", name: "Northwind Writer", prompt: "Write short." }],
  "let the writer go": ["agent_set", { agent: "acme-writer", archive: true }],
  "show the team": ["agent_set", {}],
  "hire a designer": ["agent_set", { slug: "designer", name: "Designer", role: "Designer", area: "Design" }],
  "hire a lead": [
    "agent_set",
    { slug: "lead", name: "Lead", role: "Head of design", area: "design", orchestrator: true },
  ],
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const call = CALLS[said];
  return call ? callTool("c1", call[0], call[1]) : say("ok");
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  await env.client.call("agents.create", {
    slug: "acme-writer",
    name: "Acme Writer",
    role: "Writes copy",
    prompt: "Write long.",
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function ask(text: string, agent = "roby", decision?: "approve" | "deny"): Promise<string> {
  const thread = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: agent,
    title: "Team",
  });
  await env.client.call("threads.send", { thread: thread.id, text });
  if (decision) {
    const pending: Array<{ id: string; tool?: string | undefined }> = await inputsOrEnd(env.client, thread.id);
    assert.equal(pending[0]?.tool, "agent_set");
    await env.client.call("runs.respond", {
      input: pending[0]?.id ?? "",
      decision,
    });
  }
  await env.settle(thread.id);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
}

const agent = async (id: string) => (await env.client.call("agents.list", {})).agents.find((a) => a.id === id);

test("only the super-agent is offered agent_set", async () => {
  const offered = async (agent: string) => {
    await ask("hello", agent);
    return llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
  };
  assert.ok((await offered("roby")).includes("agent_set"));
  assert.ok(!(await offered("acme-writer")).includes("agent_set"));
});

test("reading an agent's definition and prompt needs no OK", async () => {
  assert.match(
    await ask("show me Acme Writer"),
    /^Acme Writer \(id: acme-writer\)\nrole: Writes copy\nprompt:\nWrite long\.$/,
  );
});

test("an agent is created, changed and archived only once the owner says yes", async () => {
  assert.match(await ask("hire a sentry", "roby", "deny"), /not run: the owner declined/);
  assert.equal(await agent("sentry"), undefined);

  assert.match(
    await ask("hire a researcher", "roby", "approve"),
    /created: Researcher \(id: researcher\) as a global agent \(no project\)/,
  );
  assert.equal((await agent("researcher"))?.role, "Finds sources");

  assert.match(await ask("rename the writer", "roby", "approve"), /saved: Northwind Writer \(id: acme-writer/);
  const writer = await env.client.call("agents.get", { agent: "acme-writer" });
  assert.equal(writer.agent.name, "Northwind Writer");
  assert.equal(writer.agent.role, "Writes copy", "what was not given stays");
  assert.equal(writer.prompt, "Write short.");

  assert.match(await ask("let the writer go", "roby", "approve"), /removed Northwind Writer: .*apx:settings\/agents/);
  assert.equal(await agent("acme-writer"), undefined);
});

test("a new agent goes to the project it names, from any chat, and the answer says where", async () => {
  const { project } = await env.client.call("projects.create", {
    name: "Northwind",
  });
  assert.match(
    await ask("hire a tester for northwind", "roby", "approve"),
    /created: Tester \(id: .+\) in the project Northwind$/,
  );
  const tester = (await env.client.call("agents.list", {})).agents.find((a) => a.name === "Tester");
  assert.equal(tester?.project_id, project.id);

  assert.match(await ask("hire one for nowhere", "roby", "approve"), /unknown project "Nowhere"/);
  assert.equal(
    (await env.client.call("agents.list", {})).agents.find((a) => a.name === "Lost"),
    undefined,
  );
});

test("the team sheet lists kind, areas and roles; an area exists only in a company and joins its list", async () => {
  assert.match(await ask("show the team"), /^project kind: not set \(areas only exist in company projects/);
  assert.match(await ask("hire a designer", "roby", "approve"), /not run: areas only exist in company projects/);
  assert.equal(await agent("designer"), undefined);

  await env.client.call("projects.update_base", { kind: "company" });
  assert.match(await ask("hire a designer", "roby", "approve"), /created: Designer/);
  assert.equal((await agent("designer"))?.area, "design");
  assert.match(await ask("hire a lead", "roby", "approve"), /created: Lead/);
  const lead = await agent("lead");
  assert.equal(lead?.area, "design", "the area is found by its slug, not added twice");
  assert.equal(lead?.orchestrator, true);
  const org = await env.client.call("org.get", {});
  assert.deepEqual(
    org.areas.map((a) => a.slug),
    ["design"],
  );
  assert.deepEqual(
    org.roles.map((r) => [r.name, r.area]),
    [
      ["Designer", "design"],
      ["Head of design", "design"],
    ],
  );
  assert.match(await ask("show the team"), /areas: Design \(design\)\nroles: Designer; Head of design/);
});

test("a new agent with no name given gets a person's name from APX's generator, none the crew uses", async () => {
  const taken = (await env.client.call("agents.list", {})).agents.map((a) => a.name);
  assert.match(await ask("hire a triager", "roby", "approve"), /created: \S+ \(id: issue-triage\)/);
  const made = await agent("issue-triage");
  assert.ok(made && (AGENT_NAMES as readonly string[]).includes(made.name), made?.name);
  assert.ok(!taken.includes(made.name), `${made.name} was already in use`);
  assert.equal(made.role, "Issue triage", "the job stays the role");
});

test("a sentence as a role is sent back before the owner is asked: the longer text goes in description", async () => {
  assert.match(await ask("hire a wordy one"), /role is a short title .*put the longer text in description/);
  assert.equal(await agent("wordy"), undefined);
  assert.equal((await env.client.call("runs.pending", {})).inputs.length, 0);
});
