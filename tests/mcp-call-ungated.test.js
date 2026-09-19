// `call_mcp` is not graded, and nothing measures a third-party tool by its name.
//
// The deleted core/mcp/tool-risk.js split the target tool's name into words and
// looked them up in two lists of English verbs and nouns. `cheto_task_update`
// contains "update", so it came back dangerous; under `automatico` that is a
// confirmation dialog, and the company-council-cmo routine had nobody to show
// one to. It died four runs in a row on a call that needed no person, while its
// allowed_tools already listed `call_mcp` — which `automatico` never reads.
//
// These pin the rule that replaced it: APX grades its OWN tools and lets the
// permission mode bound an MCP call like any other.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mcp-ungated-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
// HOME alone is not enough — #core reads APX_HOME, and a test that forgets it
// writes into the real ~/.apx. Set before any #core import.
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: callMcp } = await import("#core/agent/tools/handlers/call-mcp.js");
const { createPermissionGuard } = await import("#core/agent/tools/helpers.js");
const { blockedForPermissionError } = await import("#core/routines/runner.js");

// Names the old heuristic graded dangerous: a write verb, a destructive verb,
// and the fail-closed tie it had no opinion about.
const ONCE_GATED = ["cheto_task_update", "appsi_delete_campaign", "frobnicate"];

function harness(permissionMode, allowedTools = []) {
  const calls = [];
  const probes = [];
  const project = { id: 0, name: "t", path: TMP_HOME, config: {} };
  const registry = {
    call: (mcp, tool, args) => {
      calls.push({ mcp, tool, args });
      return { ok: true, tool };
    },
    // Present so an accidental reintroduction of the probe is visible rather
    // than silently costing a round trip per call.
    listTools: (mcp) => { probes.push(mcp); return []; },
    getByName: (mcp) => { probes.push(mcp); return null; },
  };
  const handler = callMcp.makeHandler({
    projects: { get: () => project, list: () => [{ id: 0 }], current: () => project },
    registries: { for: () => registry },
    requirePermission: createPermissionGuard(
      { super_agent: { permission_mode: permissionMode, allowed_tools: allowedTools } },
      { requestConfirmation: null },
    ),
  });
  return { handler, calls, probes };
}

test("automatico runs every MCP tool, whatever it is called", async () => {
  const { handler, calls } = harness("automatico");
  for (const tool of ONCE_GATED) {
    const out = await handler({ mcp: "cheto", tool, args: { task: 377 } });
    assert.equal(out.ok, true, `${tool} should run unattended`);
  }
  assert.deepEqual(calls.map((c) => c.tool), ONCE_GATED);
});

test("total runs them too", async () => {
  const { handler, calls } = harness("total");
  await handler({ mcp: "cheto", tool: "cheto_task_update", args: {} });
  assert.equal(calls.length, 1);
});

test("permiso is the one mode that gates, and allowed_tools is the way through", async () => {
  const denied = harness("permiso", []);
  await assert.rejects(
    () => denied.handler({ mcp: "cheto", tool: "cheto_areas", args: {} }),
    /requires user confirmation/,
    "an unlisted call_mcp still asks",
  );
  assert.equal(denied.calls.length, 0, "and does not reach the server");

  // The same allowlist the blocked routine already carried. Under `permiso` it
  // works, which is what the error message now says and did not before.
  const allowed = harness("permiso", ["call_mcp"]);
  await allowed.handler({ mcp: "cheto", tool: "cheto_task_update", args: {} });
  assert.equal(allowed.calls.length, 1);
});

test("the handler no longer interrogates the server to decide", async () => {
  const { handler, probes } = harness("automatico");
  await handler({ mcp: "cheto", tool: "cheto_task_update", args: {} });
  assert.deepEqual(probes, [], "no listTools / getByName round trip per call");
});

test("a blocked routine is told the lever that actually moves", () => {
  const auto = blockedForPermissionError(["call_mcp"], "automatico");
  assert.match(auto, /does NOT consult allowed_tools/);
  assert.match(auto, /permission_mode to `total`/);

  const permiso = blockedForPermissionError(["call_mcp"], "permiso");
  assert.match(permiso, /add call_mcp to its allowed_tools/);

  // In `total` the mode agrees with the guard, so a block came from elsewhere.
  assert.match(blockedForPermissionError(["run_shell"], "total"), /security_risk/);
});
