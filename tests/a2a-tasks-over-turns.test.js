// Work moves through tasks; a2a is for the live exchange.
//
// 2026-09-23: routine briefs tagged [status] arrived at the super-agent as full
// turns, were read as orders, got delegated, and every answer woke it again —
// ~230 a2a turns in under an hour, nobody watching. These pin the three rules
// that close that loop at the prompt: a report is information, not an order;
// a notice is FILED (no --deliver); work for another agent is a task.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prompt = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "core", "agent", "prompts", ...p), "utf8");
const { buildA2AReplySystem } = await import("#core/agent/a2a/reply.js");

test("the a2a channel says a report is not an order to delegate", () => {
  const a2a = prompt("channels", "a2a.md");
  assert.match(a2a, /information, not an order/);
  assert.match(a2a, /do not delegate from it/);
  assert.match(a2a, /open a task assigned to the agent/);
});

test("every agent is told: work for another agent is a task, a2a is for a live owner", () => {
  const base = prompt("core", "agent-base.md");
  assert.match(base, /# Work for another agent is a task/);
  assert.match(base, /create_task/);
  assert.match(base, /comment_task/);
  assert.match(base, /live conversation/);
});

test("the orchestrator's etiquette does not turn a report into delegation", () => {
  const sys = buildA2AReplySystem({ toAgent: { slug: "default", fields: {} }, fromAgent: { slug: "ceo" }, config: {} });
  assert.match(sys, /not a request to act now/);
  assert.match(sys, /create a task assigned/);
});

test("a project agent relays a notice without opening a turn; only a blocker delivers", () => {
  const sys = buildA2AReplySystem({ toAgent: { slug: "cfo", fields: {} }, fromAgent: { slug: "ceo" }, config: {} });
  // The notice line carries no --deliver; the blocker line does.
  const notice = sys.split("\n").find((l) => l.includes("--severity status"));
  assert.ok(notice, "the relay instruction is there");
  assert.match(notice, /no `--deliver`/);
  assert.match(sys, /--severity blocker --deliver --background/);
  assert.doesNotMatch(sys, /"…" --deliver` or/, "the old every-notice --deliver relay is gone");
});
