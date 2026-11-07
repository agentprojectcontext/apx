import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "@apx/protocol";
import { channelAgents } from "./agents.ts";

const agent = (id: string, fields: Partial<Agent> = {}): Agent => ({
  id,
  name: id,
  role: "Helper",
  kind: "agent",
  source: "local",
  browser_profile: "isolated",
  ...fields,
});
const secretary = agent("superagent", { name: "Roby", kind: "secretary" });
const specialist = agent("andy", { name: "Andy" });
const lead = agent("northwind-lead", { slug: "lead", project_id: "northwind", orchestrator: true });
const builder = agent("northwind-builder", { slug: "builder", project_id: "northwind", parent: "lead" });
const solo = agent("globex-writer", { slug: "writer", project_id: "globex" });
const twoA = agent("initech-a", { slug: "a", project_id: "initech" });
const twoB = agent("initech-b", { slug: "b", project_id: "initech" });
const roster = [twoB, builder, specialist, solo, lead, twoA, secretary];

test("a channel can be handed to the super-agent and the head of each project, and no one else", () => {
  assert.deepEqual(
    channelAgents(roster).map((a) => a.id),
    ["superagent", "globex-writer", "northwind-lead"],
  );
});

test("a project whose head cannot be told lists no one, and the agent already chosen stays listed", () => {
  assert.ok(!channelAgents(roster).some((a) => a.project_id === "initech"));
  assert.deepEqual(
    channelAgents(roster, "initech-b").map((a) => a.id),
    ["superagent", "globex-writer", "initech-b", "northwind-lead"],
  );
  assert.deepEqual(
    channelAgents(roster, "andy").map((a) => a.id),
    ["superagent", "andy", "globex-writer", "northwind-lead"],
  );
});
