import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, Routine } from "@apx/protocol";
import { reportRoutines } from "./discoveryReports.ts";

const routine = (id: string, agent_id: string, extra: Partial<Routine> = {}) =>
  ({ id, name: id, agent_id, action: "agent", enabled: true, ...extra }) as Routine;
const agent = (id: string, kind: string) => ({ id, kind }) as Agent;

test("a report run by a super-agent with its own id is offered", () => {
  const agents = { roby: agent("roby", "secretary"), coder: agent("coder", "agent") };
  const picked = reportRoutines(
    [
      routine("morning", "roby"),
      routine("coder-daily", "coder"),
      routine("project-report", "roby", { project_id: "acme" }),
      routine("relay", "roby", { action: "relay" } as Partial<Routine>),
    ],
    agents,
  );
  assert.deepEqual(
    picked.map((r) => r.id),
    ["morning"],
  );
});
