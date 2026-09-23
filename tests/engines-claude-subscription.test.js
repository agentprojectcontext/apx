// Offline unit tests for Claude subscription OAuth store + headers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncPaths } from "#core/config/paths.js";
import {
  claudeSubscriptionHeaders,
  readApxClaudeAuth,
  writeApxClaudeAuth,
  clearApxClaudeAuth,
  claudeSubscriptionAuthPath,
} from "#core/engines/claude-subscription-oauth.js";
import { getAdapter, ENGINE_IDS } from "#core/engines/index.js";
import { ENGINE_PRESETS } from "#core/engines/presets.js";

test("claude-subscription registered + preset key_optional", () => {
  assert.ok(ENGINE_IDS.includes("claude-subscription"));
  assert.equal(getAdapter("claude-subscription").id, "claude-subscription");
  assert.equal(ENGINE_PRESETS["claude-subscription"]?.key_optional, true);
});

test("write/read APX Claude auth under APX_HOME", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-claude-auth-"));
  const prev = process.env.APX_HOME;
  process.env.APX_HOME = home;
  syncPaths();
  try {
    clearApxClaudeAuth();
    assert.equal(readApxClaudeAuth(), null);
    writeApxClaudeAuth({
      accessToken: "sk-ant-oat-test",
      refreshToken: "rt-test",
      expiresAt: Date.now() + 3600_000,
      source: "pkce",
    });
    const stored = readApxClaudeAuth();
    assert.equal(stored.accessToken, "sk-ant-oat-test");
    assert.equal(stored.refreshToken, "rt-test");
    assert.equal(stored.path, claudeSubscriptionAuthPath());
    const h = claudeSubscriptionHeaders(stored.accessToken);
    assert.match(h.authorization, /^Bearer sk-ant-oat-test$/);
    assert.ok(h["anthropic-beta"].includes("oauth-2025-04-20"));
    assert.match(h["user-agent"], /^claude-code\//);
  } finally {
    if (prev == null) delete process.env.APX_HOME;
    else process.env.APX_HOME = prev;
    syncPaths();
  }
});
