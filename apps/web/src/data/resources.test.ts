import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { McpServerStatus } from "@apx/protocol";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const resources = await import("./resources.ts");
if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
else Reflect.deleteProperty(globalThis, "window");

function mockRpc(t: TestContext, handlers: Record<string, unknown>) {
  const calls: [string, unknown][] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1) ?? "";
    const params = JSON.parse(String(init.body));
    calls.push([method, params]);
    assert.ok(Object.hasOwn(handlers, method), `unexpected RPC ${method}`);
    const result = handlers[method];
    if (result instanceof Error) throw result;
    return Response.json({ ok: true, result: typeof result === "function" ? await result(params) : result });
  });
  return calls;
}

test("resource reads and writes preserve global and project scope and return response data", async (t) => {
  const calls = mockRpc(t, {
    "skills.list": { skills: [{ name: "review" }] },
    "skills.get": { name: "review", content: "Check behavior" },
    "skills.save": { skill: { name: "review" } },
    "skills.preview": { candidates: [{ id: "candidate_1" }] },
    "skills.import": { imported: ["review"] },
    "skills.toggle": {},
    "mcp.list": { servers: [{ name: "tools" }] },
    "mcp.toggle": { servers: [{ name: "tools", enabled: false }] },
    "mcp.trust": { server: { name: "tools", trusted: true } },
    "mcp.test": { ok: true },
    "mcp.set": { servers: [] },
    "secrets.list": { secrets: [{ name: "TOKEN", configured: true }] },
    "secrets.set": {},
    "resources.inheritance": { skills: true, mcp: false },
    "resources.inherit": { ok: true },
    "tools.approvals": { approvals: [] },
    "tools.revoke": {},
  });
  assert.deepEqual(await resources.listSkills(), [{ name: "review" }]);
  assert.deepEqual(await resources.listSkills("prj_1"), [{ name: "review" }]);
  assert.equal((await resources.getSkill("review", "prj_1"))?.content, "Check behavior");
  assert.deepEqual(await resources.saveSkill("review", "project", "body", "prj_1"), { name: "review" });
  assert.deepEqual(await resources.previewSkillImport({ kind: "folder", path: "~/skills" }, "prj_1"), [
    { id: "candidate_1" },
  ]);
  assert.deepEqual(await resources.importSkills({ kind: "folder", path: "~/skills" }, ["candidate_1"], true, "prj_1"), {
    imported: ["review"],
  });
  assert.deepEqual(await resources.toggleSkill("review", false), {});
  assert.deepEqual(await resources.listMcp(), [{ name: "tools" }]);
  assert.deepEqual(await resources.toggleMcp("prj_1", "tools", false), [{ name: "tools", enabled: false }]);
  const server = { scope: "global", name: "tools" } as McpServerStatus;
  assert.deepEqual(await resources.trustMcp(undefined, "tools", true), { name: "tools", trusted: true });
  assert.deepEqual(await resources.testMcp(server), { ok: true });
  assert.deepEqual(await resources.setMcp("tools", { command: "node", args: ["server.js"] }, "prj_1"), []);
  assert.deepEqual(await resources.listSecrets(), [{ name: "TOKEN", configured: true }]);
  assert.deepEqual(await resources.setSecret("TOKEN", null), {});
  assert.deepEqual(await resources.getInheritance("prj_1"), { skills: true, mcp: false });
  assert.deepEqual(await resources.setInheritance("prj_1", "mcp", true), { ok: true });
  assert.deepEqual(await resources.listApprovals(), []);
  assert.deepEqual(await resources.revokeApproval("tools:key", "thr_1", "roby"), {});
  assert.deepEqual(calls[0], ["skills.list", {}]);
  assert.deepEqual(calls[1], ["skills.list", { project: "prj_1" }]);
  assert.deepEqual(calls.at(-1), ["tools.revoke", { key: "tools:key", thread: "thr_1", agent: "roby" }]);
});

test("bulk MCP mode only changes tools not already at the requested approval state", async (t) => {
  const calls = mockRpc(t, {
    "mcp.tools": {
      tools: [
        { name: "read", key: "mcp:read", approved: false },
        { name: "write", key: "mcp:write", approved: true },
      ],
    },
    "mcp.approveTool": {},
    "tools.revoke": {},
  });
  const server = { scope: "project", name: "local", project_id: "prj_1" } as McpServerStatus;
  assert.deepEqual(await resources.setMcpToolMode(server, "all", "prj_1"), { ok: true });
  assert.deepEqual(await resources.setMcpToolMode(server, "ask", "prj_1"), { ok: true });
  assert.deepEqual(calls, [
    ["mcp.tools", { scope: "project", server: "local", project: "prj_1" }],
    ["mcp.approveTool", { scope: "project", server: "local", tool: "read", project: "prj_1" }],
    ["mcp.tools", { scope: "project", server: "local", project: "prj_1" }],
    ["tools.revoke", { key: "mcp:write" }],
  ]);
});

test("resource batches stop on server errors and expose a user-facing notice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = mockRpc(t, { "mcp.tools": { tools: [], error: "server unavailable" }, "mcp.approveTool": {} });
  assert.equal(
    await resources.setMcpToolMode({ scope: "global", name: "broken" } as McpServerStatus, "all"),
    undefined,
  );
  assert.deepEqual(
    calls.map(([method]) => method),
    ["mcp.tools"],
  );
});
