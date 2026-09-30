// Roby's chat counts the work Roby handed out — and what those agents handed on.
// Scoped by project it showed nothing: its chat is in `default`, the jobs live
// in the project of the agent it reached.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { jobsForScope, SUPER_AGENT_ACTOR } = await import(path.join(ROOT, "src/interfaces/web/src/lib/jobs-scope.ts"));

const jobs = [
  { id: "a", from: "super_agent", to: "lead", project_id: 4 },
  { id: "b", from: "lead", to: "editor", project_id: 4 },
  { id: "c", from: "scout", to: "writer", project_id: 1 },
  { id: "d", from: "editor", to: null, project_id: 4 },
];

test("an agent's chat sees its hand-offs and the chain below them, in any project", () => {
  const scoped = jobsForScope(jobs, { projectId: 0, agentSlug: SUPER_AGENT_ACTOR });
  assert.deepEqual(scoped.map((s) => [s.job.id, s.depth]), [["a", 0], ["b", 1], ["d", 2]]);
});

test("without an agent, the project scope stays what it was", () => {
  assert.deepEqual(jobsForScope(jobs, { projectId: 4 }).map((s) => s.job.id), ["a", "b", "d"]);
  assert.deepEqual(jobsForScope(jobs, { projectId: 1 }).map((s) => s.job.id), ["c"]);
});
