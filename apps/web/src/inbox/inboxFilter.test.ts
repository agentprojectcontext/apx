import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, Thread } from "@apx/protocol";
import { passesFilter } from "./inboxFilter.ts";

const chat = (agent: string, project?: string) =>
  ({ id: `${agent}-${project}`, agent_ids: [agent], ...(project ? { project_id: project } : {}) }) as unknown as Thread;
const projects = [
  { id: "p_web", name: "Web", parent: "p_acme" },
  { id: "p_acme", name: "Acme" },
] as unknown as Project[];

test("nothing chosen lets every chat through", () => {
  assert.equal(passesFilter(chat("roby"), { agents: [], projects: [] }, projects), true);
});

test("agents: any of them; projects: any of them; both kinds must match", () => {
  const f = { agents: ["roby", "cody"], projects: ["p_acme"] };
  assert.equal(passesFilter(chat("cody", "p_acme"), f, projects), true);
  assert.equal(passesFilter(chat("magui", "p_acme"), f, projects), false);
  assert.equal(passesFilter(chat("roby", "p_other"), f, projects), false);
});

test("a project takes its subprojects' chats", () => {
  assert.equal(passesFilter(chat("roby", "p_web"), { agents: [], projects: ["p_acme"] }, projects), true);
});
