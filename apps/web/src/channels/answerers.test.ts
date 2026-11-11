import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, ChannelInfo } from "@apx/protocol";
import type { T } from "../i18n/index.ts";
import { answerersOf, answersLine } from "./answerers.ts";

const texts: Record<string, string> = {
  "ch.answersBy": "{agent} answers",
  "ch.answersSplit": "You talk to {agent} · {contacts} answers your contacts",
  "ch.agentGone": "an agent that no longer exists",
};
const t: T = (key, vars) => (texts[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""));
const agents = { a1: { id: "a1", name: "Ada" }, a2: { id: "a2", name: "Bruno" } } as unknown as Record<string, Agent>;
const account = (agent_id: string, contacts_agent_id?: string) =>
  ({ id: "c1", agent_id, contacts_agent_id }) as unknown as ChannelInfo;

test("an account whose contacts have another agent says both", () => {
  assert.equal(
    answersLine(answerersOf(account("a1", "a2"), agents), t),
    "You talk to Ada · Bruno answers your contacts",
  );
  assert.equal(answersLine(answerersOf(account("a1", "a1"), agents), t), "Ada answers");
  assert.equal(answersLine(answerersOf(account("a1"), agents), t), "Ada answers");
});

test("a removed agent never shows as its id", () => {
  assert.equal(answersLine(answerersOf(account("gone-7"), agents), t), "An agent that no longer exists answers");
  const split = answersLine(answerersOf(account("a1", "gone-7"), agents), t);
  assert.equal(split, "You talk to Ada · an agent that no longer exists answers your contacts");
});
