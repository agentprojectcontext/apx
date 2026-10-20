import assert from "node:assert/strict";
import { test } from "node:test";
import { parentIn, reportsOf, type TeamNode, teamHead } from "./team-tree.ts";

const a = (slug: string, extra: Partial<TeamNode> = {}): TeamNode => ({
  id: `p1-${slug}`,
  slug,
  name: slug,
  role: "Member",
  ...extra,
});

test("parent: names an agent by its slug or its full id, never itself", () => {
  const lead = a("lead");
  const bySlug = a("x", { parent: "lead" });
  const byId = a("y", { parent: "p1-lead" });
  const self = a("z", { parent: "p1-z" });
  const team = [lead, bySlug, byId, self];
  assert.equal(parentIn(team, bySlug), lead);
  assert.equal(parentIn(team, byId), lead);
  assert.equal(parentIn(team, self), undefined);
  assert.deepEqual(reportsOf(team, lead), [bySlug, byId]);
});

test("a marked sub-team lead leads its reports, not the team: the marked root heads it", () => {
  const head = a("head", { orchestrator: true });
  const reels = a("reels", { parent: "head" });
  const sub = a("sub", { parent: "p1-reels", orchestrator: true });
  const team = [sub, a("w1", { parent: "sub" }), reels, head];
  assert.deepEqual(teamHead(team), { agent: head, selection: "marked" });
});

test("only a marked sub-team lead: the head falls back to inference among roots", () => {
  const top = a("top", { role: "Director" });
  const sub = a("sub", { parent: "top", orchestrator: true, role: "Team lead" });
  assert.deepEqual(teamHead([sub, top]), { agent: top, selection: "sole_head" });
  const ceo = a("boss", { role: "CEO" });
  const sub2 = a("sub", { parent: "boss", orchestrator: true, role: "Team lead" });
  assert.deepEqual(teamHead([sub2, a("loose"), ceo]), { agent: ceo, selection: "role" });
});

test("a parent given by full id makes the agent a report, not a second root", () => {
  const head = a("head", { role: "Engineering" });
  const team = [head, a("x", { parent: "p1-head" })];
  assert.deepEqual(teamHead(team), { agent: head, selection: "sole_head" });
});

test("an agent unmarked as orchestrator is never guessed to be the head", () => {
  assert.equal(teamHead([a("lead", { role: "Lead orchestrator", orchestrator: false })]), undefined);
  assert.equal(teamHead([a("one"), a("two")]), undefined);
});
