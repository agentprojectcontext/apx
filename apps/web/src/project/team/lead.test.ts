import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "@apx/protocol";
import { teamLead } from "./lead.ts";

const a = (slug: string, extra: Partial<Agent> = {}): Agent => ({
  id: `acme-${slug}`,
  slug,
  name: slug,
  role: "Member",
  kind: "agent",
  browser_profile: "shared",
  source: "apc",
  project_id: "acme",
  ...extra,
});

test("a marked sub-team lead stays under the project's head on the chart", () => {
  const sub = a("ada", { parent: "acme-reels", orchestrator: true });
  const team = [sub, a("w1", { parent: "ada" }), a("reels", { parent: "boss" }), a("boss", { role: "Director" })];
  assert.equal(teamLead(team)?.id, "acme-boss", "the only root heads it although the sub-team lead is marked");
  assert.equal(teamLead([...team.slice(0, 3), a("boss", { orchestrator: true })])?.id, "acme-boss");
});

test("the super-agent heads its team before anyone marked", () => {
  const roby = a("superagent", { kind: "secretary", project_id: undefined });
  assert.equal(teamLead([a("x", { orchestrator: true }), roby])?.id, "acme-superagent");
});
