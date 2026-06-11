// CLI tests for `apx project config` — verifies the four commands shape the
// correct HTTP calls. The daemon endpoints already exist and are not exercised
// here; we mock the http module in-process.

import { test } from "node:test";
import assert from "node:assert/strict";

const { http } = await import("#interfaces/cli/http.js");
const {
  cmdProjectConfigShow,
  cmdProjectConfigSet,
  cmdProjectConfigUnset,
} = await import("#interfaces/cli/commands/project-config.js");

function installStub({
  projects = [{ id: 7, name: "iacrmar", path: "/tmp/iacrmar" }],
  effective,
  projectOnly = {},
} = {}) {
  const calls = [];
  http.get = async (p) => {
    calls.push(["GET", p, null]);
    if (p === "/projects") return projects;
    if (p.startsWith("/projects/") && p.endsWith("/config")) {
      return {
        // Default: effective shows the global value; project_only is empty.
        effective: effective || { super_agent: { model: "global:x" } },
        project_only: projectOnly,
        project_config_path: "/tmp/iacrmar/.apc/config.json",
      };
    }
    return {};
  };
  http.post = async (p, body) => {
    calls.push(["POST", p, body]);
    return { ok: true };
  };
  http.patch = async (p, body) => {
    calls.push(["PATCH", p, body]);
    return { ok: true };
  };
  http.put = async (p, body) => {
    calls.push(["PUT", p, body]);
    return { ok: true };
  };
  return calls;
}

function captureLog(fn) {
  let captured = "";
  const orig = console.log;
  console.log = (...args) => { captured += args.join(" ") + "\n"; };
  return Promise.resolve(fn()).finally(() => { console.log = orig; }).then(() => captured);
}

test("cmdProjectConfigShow without --key prints full effective+project_only JSON", async () => {
  installStub({
    effective: { super_agent: { model: "local:y" } },
    projectOnly: { super_agent: { model: "local:y" } },
  });
  const out = await captureLog(() => cmdProjectConfigShow({ _: ["iacrmar"], flags: {} }));
  assert.match(out, /"effective"/);
  assert.match(out, /"project_only"/);
  assert.match(out, /"model": "local:y"/);
});

test("cmdProjectConfigShow --key prints just that key from both objects", async () => {
  installStub({
    effective: { super_agent: { model: "global:x" } },
    projectOnly: { super_agent: { model: "local:y" } },
  });
  const out = await captureLog(() =>
    cmdProjectConfigShow({ _: ["iacrmar"], flags: { key: "super_agent.model" } })
  );
  assert.match(out, /effective\.super_agent\.model\s*=\s*"global:x"/);
  assert.match(out, /project_only\.super_agent\.model\s*=\s*"local:y"/);
});

test("cmdProjectConfigSet sends PATCH set with coerced value and reloads", async () => {
  const calls = installStub();
  await cmdProjectConfigSet({
    _: ["iacrmar", "super_agent.model", "groq:llama-3.3-70b-versatile"],
    flags: {},
  });
  const patch = calls.find((c) => c[0] === "PATCH");
  assert.deepEqual(patch[2], { set: { "super_agent.model": "groq:llama-3.3-70b-versatile" } });
  assert.ok(calls.find((c) => c[0] === "POST" && c[1] === "/admin/reload"));
});

test("cmdProjectConfigSet coerces booleans and numbers", async () => {
  const calls = installStub();
  await cmdProjectConfigSet({ _: ["iacrmar", "x.bool", "true"], flags: {} });
  await cmdProjectConfigSet({ _: ["iacrmar", "x.num", "42"], flags: {} });
  const patches = calls.filter((c) => c[0] === "PATCH").map((c) => c[2]);
  assert.deepEqual(patches[0], { set: { "x.bool": true } });
  assert.deepEqual(patches[1], { set: { "x.num": 42 } });
});

test("cmdProjectConfigSet keeps strings that don't parse as JSON/number/bool", async () => {
  const calls = installStub();
  await cmdProjectConfigSet({ _: ["iacrmar", "x.label", "permiso"], flags: {} });
  const patch = calls.find((c) => c[0] === "PATCH");
  assert.deepEqual(patch[2], { set: { "x.label": "permiso" } });
});

test("cmdProjectConfigUnset sends PATCH unset", async () => {
  const calls = installStub();
  await cmdProjectConfigUnset({ _: ["iacrmar", "super_agent.model"], flags: {} });
  const patch = calls.find((c) => c[0] === "PATCH");
  assert.deepEqual(patch[2], { unset: ["super_agent.model"] });
});

test("cmdProjectConfigSet errors when value is missing", async () => {
  installStub();
  await assert.rejects(
    () => cmdProjectConfigSet({ _: ["iacrmar", "x.y"], flags: {} }),
    /missing <value>/
  );
});

test("cmdProjectConfigShow errors when project is missing", async () => {
  installStub();
  await assert.rejects(
    () => cmdProjectConfigShow({ _: [], flags: {} }),
    /missing <project>/
  );
});
