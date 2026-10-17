import assert from "node:assert/strict";
import { test } from "node:test";
import { agentLimits } from "./agent-fields.ts";
import { agentEdit, agentSetOf } from "./models.ts";
import { printed, recordingClient } from "./testing.ts";

test("agents set takes key=value pairs, the prompt from a file or stdin, or both", () => {
  const read = (f: string) => `Prompt from ${f}`;
  assert.deepEqual(agentSetOf("april", ["role=Sales"], undefined, read), { agent: "april", role: "Sales" });
  assert.deepEqual(agentSetOf("april", [], "-", read), { agent: "april", prompt: "Prompt from -" });
  assert.deepEqual(agentSetOf("april", ["name=April"], "p.md", read), {
    agent: "april",
    name: "April",
    prompt: "Prompt from p.md",
  });
  assert.throws(() => agentSetOf("april", [], undefined, read), /usage: apx agents set/);
  assert.throws(() => agentSetOf("april", ["prompt=x"], "p.md", read), /not both/);
});

test("agents show prints its fields and full prompt", async () => {
  const { client, calls } = recordingClient({
    "agents.get": {
      agent: {
        id: "april",
        name: "April",
        role: "Sales at Acme",
        kind: "agent",
        browser_profile: "shared",
        source: "local",
        model_choice: { router: true },
        autonomy: "ask",
      },
      prompt: "Answer every Northwind lead.\nKeep it short.",
    },
  });
  const out = await printed(() => agentEdit(client, ["show", "april"], {}));
  assert.deepEqual(calls, [["agents.get", { agent: "april" }]]);
  assert.match(out, /^april {2}April\nRole: +Sales at Acme\nModel: +router\nAutonomy: +ask/);
  assert.match(out, /\n\nAnswer every Northwind lead\.\nKeep it short\.$/);
});

test("agents clone sends the agents, the target project and --rename", async () => {
  const { client, calls } = recordingClient({
    "agents.clone": {
      cloned: [{ id: "nw:nova", name: "Nova", parent: "boss" }],
      skipped: [{ agent: "Roby", reason: "the super-agent is one for the whole install" }],
    },
  });
  const out = await printed(() =>
    agentEdit(client, ["clone", "acme:lead", "roby"], { project: "p_nw", rename: true, under: "boss" }),
  );
  assert.match(out, /Nova \(nw:nova\) · reports to boss/);
  assert.match(out, /skipped Roby: the super-agent/);
  assert.deepEqual(calls, [
    ["agents.clone", { agents: ["acme:lead", "roby"], rename: true, project_id: "p_nw", hang_under: "boss" }],
  ]);
});

test("agents set types each field from the protocol: lists, booleans, JSON, enums, and empty for the default", () => {
  const read = (f: string) => `Prompt from ${f}`;
  assert.deepEqual(
    agentSetOf(
      "april",
      [
        "tools=web_search, shell",
        "skills=",
        "orchestrator=true",
        "autonomy=edits",
        'rules={"write":"ask","outside":"off"}',
        "area=Sales",
      ],
      undefined,
      read,
    ),
    {
      agent: "april",
      tools: ["web_search", "shell"],
      skills: [],
      orchestrator: true,
      autonomy: "edits",
      rules: { write: "ask", outside: "off" },
      area: "Sales",
    },
  );
  assert.deepEqual(agentSetOf("april", ["autonomy=", "rules="], undefined, read), {
    agent: "april",
    autonomy: null,
    rules: null,
  });
  assert.throws(() => agentSetOf("april", ["colour=red"], undefined, read), /unknown field "colour"\. Fields: .*tools/);
  assert.throws(() => agentSetOf("april", ["orchestrator=maybe"], undefined, read), /true or false/);
  assert.throws(() => agentSetOf("april", ["autonomy=wild"], undefined, read), /one of ask, standard, edits, total/);
  assert.throws(() => agentSetOf("april", ["rules=write"], undefined, read), /is JSON/);
  assert.throws(() => agentSetOf("april", ['rules={"write":"never"}'], undefined, read), /rules\.write/);
});

test("agents limits shows the default and each agent's own, sets one, clears it, and sets the default", async () => {
  const { client, calls } = recordingClient({
    "agents.limits": { runs: 20, tokens: 0, defaults: { runs: 20, tokens: 0 }, agents: { april: { runs: 5 } } },
    "agents.set_agent_limits": { agents: { april: { runs: 8, tokens: 200000 } } },
    "agents.set_limits": { runs: 30, tokens: 0 },
  });
  assert.match(await printed(() => agentLimits(client, [])), /^Default: 20 turns\napril: 5 turns/);
  assert.match(
    await printed(() => agentLimits(client, ["april", "runs=8", "tokens=200000"])),
    /april: 8 turns · 200000 tokens/,
  );
  await printed(() => agentLimits(client, ["april", "clear"]));
  assert.match(await printed(() => agentLimits(client, ["default", "runs=30"])), /Default: 30 turns/);
  assert.deepEqual(
    calls.filter(([m]) => m !== "agents.limits"),
    [
      ["agents.set_agent_limits", { agent: "april", limits: { runs: 8, tokens: 200000 } }],
      ["agents.set_agent_limits", { agent: "april", limits: null }],
      ["agents.set_limits", { runs: 30, tokens: 0 }],
    ],
  );
  await assert.rejects(() => agentLimits(client, ["april", "runs=-1"]), /whole number/);
});
