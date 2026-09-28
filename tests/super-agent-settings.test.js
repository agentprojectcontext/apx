// The super-agent settings panel saves back everything it reads on each Save.
// A knob missing from GET /admin/super-agent reads blank and gets written back
// blank, so every guard the panel edits must round-trip through that view with
// the value the loop actually applies.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-sa-settings-"));
process.env.HOME = tmp;
process.env.APX_HOME = path.join(tmp, ".apx");

const { writeConfig, readConfig } = await import("#core/config/index.js");
const { register } = await import("#host/daemon/api/admin-config.js");
const { TELEGRAM_TOOL_ITERS } = await import("#core/agent/constants.js");
const { judgeConfig } = await import("#core/agent/judge.js");
const { spendLimits } = await import("#core/agent/spend-breaker.js");

function routes(config) {
  const r = {};
  register({
    get(route, fn) { r[`GET ${route}`] = fn; },
    patch(route, fn) { r[`PATCH ${route}`] = fn; },
  }, { config });
  return r;
}

function call(fn, req = {}) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  fn(req, res);
  return res;
}

test("the view carries the effective guards and the built-in step defaults", () => {
  writeConfig({ super_agent: { enabled: true } });
  const view = call(routes(readConfig())["GET /admin/super-agent"]).body;
  assert.equal(view.security_risk.enabled, false);
  assert.equal(view.security_risk.confirm_at, "HIGH");
  assert.equal(view.stuck_detection.enabled, true);
  assert.equal(view.judge.continue_unfinished, true);
  assert.equal(view.judge.enabled, false);
  assert.equal(view.spend_breaker.enabled, true);
  assert.equal(view.telegram_max_iters, 0);
  assert.equal(view.defaults.telegram_max_iters, TELEGRAM_TOOL_ITERS);
});

test("what the panel saves is what the loop reads back", () => {
  writeConfig({ super_agent: { enabled: true, self_model: "mock:self" } });
  const config = readConfig();
  const r = routes(config);
  const saved = call(r["PATCH /admin/config"], { body: { set: {
    "super_agent.security_risk.enabled": true,
    "super_agent.security_risk.confirm_at": "MEDIUM",
    "super_agent.judge.continue_unfinished": false,
    "super_agent.spend_breaker.calls_per_hour": 120,
    "super_agent.telegram_max_iters": 30,
  } } });
  assert.equal(saved.statusCode, 200);

  const view = call(r["GET /admin/super-agent"]).body;
  assert.equal(view.security_risk.enabled, true);
  assert.equal(view.security_risk.confirm_at, "MEDIUM");
  assert.equal(view.judge.continue_unfinished, false);
  assert.equal(view.spend_breaker.calls_per_hour, 120);
  assert.equal(view.telegram_max_iters, 30);
  // Untouched keys survive a partial save.
  assert.equal(view.self_model, "mock:self");

  const fresh = readConfig();
  assert.equal(judgeConfig(fresh).continue_unfinished, false);
  assert.equal(spendLimits(fresh).calls_per_hour, 120);
});
