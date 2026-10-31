import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "@apx/protocol";
import { availableAgents } from "../common/pickers/agents.ts";
import { insertMention, mentionAt, mentionToken } from "./mentions.ts";

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
const team = agent("northwind-builder", { slug: "builder", project_id: "northwind" });
const other = agent("globex-builder", { slug: "builder", project_id: "globex" });
const roster = [other, specialist, team, secretary];

test("project tasks show the super-agent first and only their team; base tasks keep specialists", () => {
  assert.deepEqual(availableAgents(roster, "northwind", false, "secretary"), [secretary, team]);
  assert.deepEqual(availableAgents(roster), [secretary, specialist]);
  assert.equal(availableAgents(roster, undefined, true)[0]?.id, secretary.id);
});

test("the mention at the caret opens the picker, preserving text after it", () => {
  const text = "Please @b check tomorrow";
  const mention = mentionAt(text, 9);
  assert.deepEqual(mention, { start: 7, end: 9, query: "b" });
  if (!mention) throw new Error("Expected mention");
  assert.deepEqual(insertMention(text, mention, "builder"), {
    text: "Please @builder  check tomorrow",
    caret: 16,
  });
  assert.deepEqual(mentionAt("@", 1), { start: 0, end: 1, query: "" });
  assert.equal(mentionAt("mail@example.com", 12), undefined);
  assert.equal(mentionAt("José@roby", 9), undefined);
  assert.equal(mentionAt("Ask @roby later", 15), undefined);
});

test("same slugs in other projects stay readable; ambiguity with a global agent uses the exact id", () => {
  assert.equal(mentionToken(team, roster, "northwind"), "builder");
  assert.equal(mentionToken(team, [...roster, agent("builder")], "northwind"), team.id);
  assert.equal(mentionToken(team, [...roster, agent("builder", { project_id: "globex" })], "northwind"), team.id);
  const ownerSlug = agent("northwind-owner", { project_id: "northwind", slug: "owner" });
  assert.equal(mentionToken(ownerSlug, [ownerSlug], "northwind"), ownerSlug.id);
});
