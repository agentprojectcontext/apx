import assert from "node:assert/strict";
import { test } from "node:test";
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
