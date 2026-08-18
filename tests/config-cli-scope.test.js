// `apx config` scope routing — which config FILE each invocation edits.
//
// Regression guard for the layer mix-up: `apx config set` resolves a project id
// and PATCHes /api/projects/:pid/config, so every key the docs and skills sent
// through it (engines.*.api_key, voice.tts.*, super_agent.*, remote.bind) landed
// in a project's committed .apc/config.json instead of ~/.apx/config.json —
// silently doing nothing for subsystems that read the global config, and
// writing credentials into a committed file. `--global` routes to the daemon's
// /api/admin/config instead, which writes the file and hot-reloads the daemon.
//
// Before the fix every --global assertion below failed: the flag was ignored
// and the call went to the project route.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Freeze CONFIG_PATH to a temp home BEFORE importing anything that reads it at
// module scope (rule 1). Nothing here writes to it — the commands under test
// reach the daemon over HTTP — but the path is printed, so it must be stable.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-config-scope-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { http } = await import("#interfaces/cli/http.js");
const { CONFIG_PATH } = await import("#core/config/index.js");
const {
  cmdConfigShow,
  cmdConfigSet,
  cmdConfigUnset,
  isGlobalScope,
} = await import("#interfaces/cli/commands/config.js");
const { default: configRoute } = await import("#interfaces/cli/routes/config.js");

const GLOBAL_CONFIG = { super_agent: { model: "acme:demo" }, engines: { openai: { api_key: "sk-…7c2d" } } };

function installStub() {
  const calls = [];
  http.get = async (p) => {
    calls.push(["GET", p, null]);
    if (p === "/api/admin/config") return { config: GLOBAL_CONFIG };
    if (p === "/api/projects") return [{ id: 7, name: "acme", path: "/path/to/acme" }];
    if (p.startsWith("/api/projects/") && p.endsWith("/config")) {
      return {
        effective: { super_agent: { model: "acme:demo" } },
        project_only: { super_agent: { model: "acme:local" } },
        project_config_path: "/path/to/acme/.apc/config.json",
      };
    }
    return {};
  };
  http.patch = async (p, body) => {
    calls.push(["PATCH", p, body]);
    return { ok: true };
  };
  return calls;
}

// Capture both streams: the global `show` deliberately splits header (stderr)
// from JSON (stdout) so the command stays pipeable into jq.
async function capture(fn) {
  const origLog = console.log;
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  console.log = (...a) => { stdout += a.join(" ") + "\n"; };
  process.stdout.write = (chunk) => { stdout += chunk; return true; };
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    await fn();
  } finally {
    console.log = origLog;
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { stdout, stderr };
}

// ---------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------

test("cmdConfigSet --global PATCHes the global admin route, not a project", async () => {
  const calls = installStub();
  await capture(() =>
    cmdConfigSet({ _: ["engines.openai.api_key", "sk-example"], flags: { global: true } })
  );
  assert.deepEqual(calls, [["PATCH", "/api/admin/config", { set: { "engines.openai.api_key": "sk-example" } }]]);
  // No project was resolved: a global edit must never read the project list.
  assert.equal(calls.filter(([, p]) => p.startsWith("/api/projects")).length, 0);
});

test("cmdConfigSet without --global still writes the project layer", async () => {
  const calls = installStub();
  await capture(() => cmdConfigSet({ _: ["super_agent.model", "acme:local"], flags: { project: "acme" } }));
  const patch = calls.find(([m]) => m === "PATCH");
  assert.deepEqual(patch, ["PATCH", "/api/projects/7/config", { set: { "super_agent.model": "acme:local" } }]);
});

test("cmdConfigSet names the layer it wrote so the file is never a guess", async () => {
  installStub();
  const globalOut = await capture(() =>
    cmdConfigSet({ _: ["super_agent.enabled", "true"], flags: { global: true } })
  );
  assert.match(globalOut.stdout, /\(global: /);
  assert.match(globalOut.stdout, new RegExp(CONFIG_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const projectOut = await capture(() =>
    cmdConfigSet({ _: ["super_agent.enabled", "true"], flags: { project: "acme" } })
  );
  assert.match(projectOut.stdout, /\(project: \.apc\/config\.json\)/);
});

test("cmdConfigSet --global parses JSON values the same way as project scope", async () => {
  const calls = installStub();
  await capture(() => cmdConfigSet({ _: ["super_agent.enabled", "true"], flags: { global: true } }));
  assert.deepEqual(calls[0][2], { set: { "super_agent.enabled": true } });
});

// ---------------------------------------------------------------------------
// unset
// ---------------------------------------------------------------------------

test("cmdConfigUnset --global PATCHes the global admin route", async () => {
  const calls = installStub();
  await capture(() => cmdConfigUnset({ _: ["super_agent.model"], flags: { global: true } }));
  assert.deepEqual(calls, [["PATCH", "/api/admin/config", { unset: ["super_agent.model"] }]]);
});

test("cmdConfigUnset without --global still targets the project layer", async () => {
  const calls = installStub();
  await capture(() => cmdConfigUnset({ _: ["super_agent.model"], flags: { project: "acme" } }));
  const patch = calls.find(([m]) => m === "PATCH");
  assert.deepEqual(patch, ["PATCH", "/api/projects/7/config", { unset: ["super_agent.model"] }]);
});

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

test("cmdConfigShow --global reads the global route and prints bare JSON on stdout", async () => {
  const calls = installStub();
  const { stdout, stderr } = await capture(() => cmdConfigShow({ _: [], flags: { global: true } }));
  assert.deepEqual(calls, [["GET", "/api/admin/config", null]]);
  // stdout must parse as JSON on its own — the header belongs on stderr.
  assert.deepEqual(JSON.parse(stdout), GLOBAL_CONFIG);
  assert.match(stderr, /global — secrets redacted/);
  assert.match(stderr, new RegExp(CONFIG_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("cmdConfigShow without --global keeps the two-layer project view", async () => {
  installStub();
  const { stdout } = await capture(() => cmdConfigShow({ _: [], flags: { project: "acme" } }));
  assert.match(stdout, /# \.apc\/config\.json \(project-only overrides\)/);
  assert.match(stdout, /# effective \(global merged with project\)/);
});

test("cmdConfigShow --global rejects the merge-only flags instead of ignoring them", async () => {
  installStub();
  for (const flag of ["effective", "only-overrides"]) {
    await assert.rejects(
      () => cmdConfigShow({ _: [], flags: { global: true, [flag]: true } }),
      new RegExp(`--${flag} describes the project/global merge`)
    );
  }
});

// ---------------------------------------------------------------------------
// scope resolution
// ---------------------------------------------------------------------------

test("isGlobalScope accepts --global and --scope global|default", () => {
  assert.equal(isGlobalScope({ global: true }), true);
  assert.equal(isGlobalScope({ scope: "global" }), true);
  assert.equal(isGlobalScope({ scope: "GLOBAL" }), true);
  assert.equal(isGlobalScope({ scope: "default" }), true);
});

test("isGlobalScope defaults to project scope", () => {
  assert.equal(isGlobalScope({}), false);
  assert.equal(isGlobalScope({ scope: "project" }), false);
  assert.equal(isGlobalScope({ project: "acme" }), false);
});

test("isGlobalScope throws on an unknown scope rather than silently going project", () => {
  // Silently falling back would write a credential into a committed file —
  // the exact accident this flag exists to prevent.
  assert.throws(() => isGlobalScope({ scope: "globl" }), /unknown --scope "globl" \(use project\|global\)/);
});

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

test("`apx config --global` routes to show instead of dying on the flag", async () => {
  const calls = installStub();
  const seen = [];
  const parseArgs = (argv) => {
    seen.push(argv);
    return { _: argv.filter((a) => !a.startsWith("-")), flags: { global: argv.includes("--global") } };
  };
  let died = null;
  await capture(() => configRoute(["--global"], { parseArgs, die: (m) => { died = m; } }));
  assert.equal(died, null);
  // The flag was handed to parseArgs, not consumed as a subcommand name.
  assert.deepEqual(seen, [["--global"]]);
  assert.deepEqual(calls, [["GET", "/api/admin/config", null]]);
});

test("`apx config set --global k v` still splits the subcommand off", async () => {
  const calls = installStub();
  const parseArgs = (argv) => ({
    _: argv.filter((a) => !a.startsWith("-")),
    flags: { global: argv.includes("--global") },
  });
  await capture(() =>
    configRoute(["set", "--global", "super_agent.model", "acme:demo"], { parseArgs, die: () => {} })
  );
  assert.deepEqual(calls, [
    ["PATCH", "/api/admin/config", { set: { "super_agent.model": "acme:demo" } }],
  ]);
});

test("an unknown subcommand still dies", async () => {
  installStub();
  let died = null;
  await configRoute(["bogus"], { parseArgs: () => ({ _: [], flags: {} }), die: (m) => { died = m; } });
  assert.match(died, /unknown config subcommand: bogus/);
});
