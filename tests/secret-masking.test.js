// Value-based secret masking (core/config/secret-values.js + core/logging.js).
//
// HOME/APX_HOME point at a temp dir BEFORE importing logging.js (LOG_DIR is
// captured at import time), so nothing touches the real ~/.apx.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-secret-masking-"));
process.env.HOME = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const {
  collectSecretValues,
  collectMcpSecretValues,
  registerSecretValues,
  getRegisteredSecretValues,
  clearRegisteredSecretValues,
  maskSecretValues,
} = await import("#core/config/secret-values.js");
const { formatLogLine, appendErrorTrace, ERROR_TRACE_PATH } = await import("#core/logging.js");

beforeEach(() => clearRegisteredSecretValues());

// ---------------------------------------------------------------------------
// collectSecretValues
// ---------------------------------------------------------------------------

test("collectSecretValues — engine keys, tts keys, telegram channel + legacy tokens", () => {
  const cfg = {
    engines: {
      anthropic: { api_key: "sk-ant-abcdef123456" },
      openai: { api_key: "sk-openai-987654" },
      groq: { api_key: "" }, // empty → ignored
    },
    voice: { tts: { elevenlabs: { api_key: "el-key-11223344" } } },
    telegram: {
      bot_token: "111111:legacy-root-token", // pre-migration shape
      channels: [
        { name: "default", bot_token: "222222:AAAA-channel-token" },
        { name: "broken", bot_token: "" },
        null,
      ],
    },
  };
  const values = collectSecretValues(cfg);
  assert.ok(values.includes("sk-ant-abcdef123456"));
  assert.ok(values.includes("sk-openai-987654"));
  assert.ok(values.includes("el-key-11223344"));
  assert.ok(values.includes("222222:AAAA-channel-token"));
  assert.ok(values.includes("111111:legacy-root-token"));
  assert.ok(!values.includes(""));
});

test("collectSecretValues — ignores short values, dedupes, safe on junk input", () => {
  const cfg = {
    engines: {
      anthropic: { api_key: "abc" }, // < 6 chars → never registered
      openai: { api_key: "same-key-123456" },
    },
    transcription: { openai: { api_key: "same-key-123456" } }, // duplicate
  };
  const values = collectSecretValues(cfg);
  assert.ok(!values.includes("abc"));
  assert.equal(values.filter((v) => v === "same-key-123456").length, 1);

  assert.deepEqual(collectSecretValues(null), []);
  assert.deepEqual(collectSecretValues("nope"), []);
  assert.deepEqual(collectSecretValues({}), []);
});

test("collectMcpSecretValues — env/header secrets by key, non-secret keys skipped", () => {
  const mcps = {
    mcpServers: {
      github: { command: "npx", env: { GITHUB_TOKEN: "ghp_secret123456", NODE_ENV: "production" } },
      remote: { url: "https://x.example", headers: { Authorization: "Bearer tok-778899" } },
    },
  };
  const values = collectMcpSecretValues(mcps);
  assert.ok(values.includes("ghp_secret123456"));
  assert.ok(values.includes("Bearer tok-778899"));
  // NODE_ENV value must NOT be registered — masking "production" everywhere
  // would mangle unrelated log lines.
  assert.ok(!values.includes("production"));

  assert.deepEqual(collectMcpSecretValues(null), []);
  assert.deepEqual(collectMcpSecretValues({}), []);
});

// ---------------------------------------------------------------------------
// registry + maskSecretValues
// ---------------------------------------------------------------------------

test("registerSecretValues — filters short/non-string, getRegisteredSecretValues reflects", () => {
  registerSecretValues(["valid-secret-1", "abc", null, 42, "  ", "valid-secret-2"]);
  const reg = getRegisteredSecretValues();
  assert.deepEqual(new Set(reg), new Set(["valid-secret-1", "valid-secret-2"]));
});

test("maskSecretValues — masks all occurrences with the ***…XXXX marker", () => {
  registerSecretValues(["sk-ant-abcdef123456"]);
  const out = maskSecretValues(
    "auth failed for sk-ant-abcdef123456 (retry with sk-ant-abcdef123456)"
  );
  assert.ok(!out.includes("sk-ant-abcdef123456"));
  assert.equal(out, "auth failed for ***…3456 (retry with ***…3456)");
});

test("maskSecretValues — longest-first handles overlapping values", () => {
  // Short value is a suffix of the long one: long must win, no shredding.
  registerSecretValues(["def123456", "abcdef123456"]);
  const out = maskSecretValues("token=abcdef123456;");
  assert.equal(out, "token=***…3456;");
  assert.ok(!out.includes("abc***"));
});

test("maskSecretValues — non-string input returned unchanged, never throws", () => {
  registerSecretValues(["some-secret-value"]);
  assert.equal(maskSecretValues(null), null);
  assert.equal(maskSecretValues(undefined), undefined);
  assert.equal(maskSecretValues(42), 42);
  const obj = { a: 1 };
  assert.equal(maskSecretValues(obj), obj);
  assert.equal(maskSecretValues(""), "");
});

// ---------------------------------------------------------------------------
// logging integration
// ---------------------------------------------------------------------------

test("formatLogLine — secret value in the free-text message is masked", () => {
  registerSecretValues(["sk-live-a1b2c3d4e5"]);
  const line = formatLogLine("ERROR", "engine", "provider rejected key sk-live-a1b2c3d4e5");
  assert.ok(!line.includes("sk-live-a1b2c3d4e5"));
  assert.match(line, /provider rejected key \*\*\*…d4e5$/);
});

test("formatLogLine — secret value under an innocuous meta key is masked too", () => {
  registerSecretValues(["ghp_tokenvalue99"]);
  // "detail" doesn't match SECRET_KEY_RE, so only the value registry can catch it.
  const line = formatLogLine("WARN", "mcp", "spawn failed", {
    detail: "env GITHUB=ghp_tokenvalue99 rejected",
  });
  assert.ok(!line.includes("ghp_tokenvalue99"));
  assert.ok(line.includes("***…ue99"));
});

test("appendErrorTrace — jsonl on disk has the value masked", () => {
  registerSecretValues(["tok-super-secret-42"]);
  try { fs.rmSync(ERROR_TRACE_PATH); } catch {}
  appendErrorTrace({
    scope: "engine",
    error: "401 Unauthorized: tok-super-secret-42 is invalid",
  });
  const raw = fs.readFileSync(ERROR_TRACE_PATH, "utf8").trim();
  assert.ok(!raw.includes("tok-super-secret-42"));
  const rec = JSON.parse(raw);
  assert.equal(rec.error, "401 Unauthorized: ***…t-42 is invalid");
});
