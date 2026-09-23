// Offline unit tests for the Codex Plus spike (auth + message shaping + SSE).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncPaths } from "#core/config/paths.js";
import {
  loadCodexPlusCreds,
  resolveCodexAuthPath,
  codexPlusHeaders,
  readCodexModelsCache,
} from "#core/engines/codex-plus-auth.js";
import {
  toResponsesInput,
  toResponsesTools,
  readResponsesStream,
} from "#core/engines/codex-plus.js";
import { getAdapter, callEngine, ENGINE_IDS } from "#core/engines/index.js";
import { ENGINE_PRESETS } from "#core/engines/presets.js";

function fakeJwt({ exp, accountId = "acct-test", residency = "no_constraint" }) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      exp,
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
        chatgpt_data_residency: residency,
      },
    })
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

function writeAuth(dir, { exp, accountId } = {}) {
  const authPath = path.join(dir, "auth.json");
  const token = fakeJwt({
    exp: exp ?? Math.floor(Date.now() / 1000) + 3600,
    accountId: accountId || "acct-123",
  });
  fs.writeFileSync(
    authPath,
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: token,
        refresh_token: "rt.fake",
        account_id: accountId || "acct-123",
        id_token: "id.fake",
      },
    })
  );
  return authPath;
}

/** Isolate APX_HOME so real ~/.apx/auth does not win over CLI borrow fixtures. */
function withIsolatedApxHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-home-codex-"));
  const prev = process.env.APX_HOME;
  process.env.APX_HOME = home;
  syncPaths();
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      if (prev == null) delete process.env.APX_HOME;
      else process.env.APX_HOME = prev;
      syncPaths();
    });
}

test("codex-plus is registered and key_optional in presets", () => {
  assert.ok(ENGINE_IDS.includes("codex-plus"));
  assert.equal(getAdapter("codex-plus").id, "codex-plus");
  assert.equal(ENGINE_PRESETS["codex-plus"]?.key_optional, true);
  assert.equal(ENGINE_PRESETS["codex-plus"]?.default_model, "gpt-5.6-luna");
});

test("resolveCodexAuthPath: auth_path wins over CODEX_HOME", () => {
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = "/tmp/codex-home-test";
  try {
    assert.equal(
      resolveCodexAuthPath({ auth_path: "/custom/auth.json" }),
      path.resolve("/custom/auth.json")
    );
    assert.equal(resolveCodexAuthPath({}), path.join("/tmp/codex-home-test", "auth.json"));
  } finally {
    if (prev == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  }
});

test("loadCodexPlusCreds reads ChatGPT account + residency from JWT", async () => {
  await withIsolatedApxHome(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-codex-plus-"));
    const authPath = writeAuth(dir, { accountId: "acct-abc" });
    const creds = await loadCodexPlusCreds({ auth_path: authPath });
    assert.equal(creds.account_id, "acct-abc");
    assert.equal(creds.residency, "no_constraint");
    assert.equal(creds.source, "cli-borrow");
    assert.ok(creds.access_token.includes("."));
    const headers = codexPlusHeaders(creds);
    assert.equal(headers["ChatGPT-Account-ID"], "acct-abc");
    assert.equal(headers["x-openai-internal-codex-residency"], "no_constraint");
    assert.match(headers.authorization, /^Bearer /);
  });
});

test("loadCodexPlusCreds rejects expired access token", async () => {
  await withIsolatedApxHome(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-codex-plus-"));
    const authPath = writeAuth(dir, { exp: Math.floor(Date.now() / 1000) - 10 });
    await assert.rejects(
      () => loadCodexPlusCreds({ auth_path: authPath }),
      /no APX|no valid Codex CLI/
    );
  });
});

test("toResponsesInput maps chat roles to Responses items", () => {
  const input = toResponsesInput([
    { role: "system", content: "ignore" },
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "echo", arguments: '{"x":1}' } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "ok" },
  ]);
  assert.equal(input[0].type, "message");
  assert.equal(input[0].role, "user");
  assert.equal(input[1].type, "function_call");
  assert.equal(input[1].call_id, "call_1");
  assert.equal(input[2].type, "function_call_output");
  assert.equal(input[2].output, "ok");
});

test("toResponsesTools flattens OpenAI tool schemas", () => {
  const tools = toResponsesTools([
    {
      type: "function",
      function: {
        name: "ping",
        description: "ping",
        parameters: { type: "object", properties: {} },
      },
    },
  ]);
  assert.deepEqual(tools, [
    {
      type: "function",
      name: "ping",
      description: "ping",
      parameters: { type: "object", properties: {} },
    },
  ]);
});

test("readResponsesStream assembles text + tool_calls from SSE", async () => {
  const chunks = [
    'data: {"type":"response.output_text.delta","delta":"Hello"}\n',
    'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_9","name":"ping","arguments":""}}\n',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"a\\":"}\n',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"1}"}\n',
    'data: {"type":"response.output_item.done","item":{"id":"fc_1","type":"function_call","call_id":"call_9","name":"ping","arguments":"{\\"a\\":1}"}}\n',
    'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":2}}}\n',
  ];
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i++]));
    },
  });
  const tokens = [];
  const result = await readResponsesStream({ body: stream }, (t) => tokens.push(t));
  assert.equal(result.text, "Hello");
  assert.deepEqual(tokens, ["Hello"]);
  assert.equal(result.finish_reason, "tool_calls");
  assert.equal(result.tool_calls?.[0]?.id, "call_9");
  assert.equal(result.tool_calls?.[0]?.function?.name, "ping");
  assert.equal(result.usage.input_tokens, 3);
});

test("readCodexModelsCache returns [] when missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-codex-models-"));
  assert.deepEqual(readCodexModelsCache({ models_cache_path: path.join(dir, "nope.json") }), []);
});

test("callEngine routes codex-plus:<model> to the adapter (mocked fetch)", async () => {
  await withIsolatedApxHome(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-codex-plus-"));
    const authPath = writeAuth(dir);
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const enc = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            enc.encode(
              'data: {"type":"response.output_text.delta","delta":"CODEX_PLUS_OK"}\n' +
                'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n'
            )
          );
          controller.close();
        },
      });
      return { ok: true, body, text: async () => "" };
    };
    try {
      const r = await callEngine({
        modelId: "codex-plus:gpt-5.6-luna",
        system: "be brief",
        messages: [{ role: "user", content: "ping" }],
        config: { engines: { "codex-plus": { auth_path: authPath } } },
      });
      assert.equal(r.text, "CODEX_PLUS_OK");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});

test("reasoning effort: provider default, per-model @suffix wins, unknown suffix untouched", async () => {
  const { splitModelEffort } = await import("#core/engines/codex-plus.js");
  assert.deepEqual(splitModelEffort("gpt-5.6-luna", {}), { model: "gpt-5.6-luna", effort: null });
  assert.deepEqual(splitModelEffort("gpt-5.6-luna", { reasoning_effort: "medium" }), { model: "gpt-5.6-luna", effort: "medium" });
  assert.deepEqual(splitModelEffort("gpt-5.6-luna@high", { reasoning_effort: "medium" }), { model: "gpt-5.6-luna", effort: "high" });
  assert.deepEqual(splitModelEffort("gpt-5.6-luna@turbo", {}), { model: "gpt-5.6-luna@turbo", effort: null });
});

test("the effort reaches the wire, and the suffix does not", async () => {
  await withIsolatedApxHome(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-codex-plus-"));
    const authPath = writeAuth(dir);
    const prevFetch = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (_url, init) => {
      sent.push(JSON.parse(init.body));
      const enc = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode('data: {"type":"response.output_text.delta","delta":"ok"}\n' +
            'data: {"type":"response.completed","response":{"status":"completed"}}\n'));
          controller.close();
        },
      });
      return { ok: true, body, text: async () => "" };
    };
    try {
      const call = (modelId, engineCfg = {}) => callEngine({
        modelId, system: "s", messages: [{ role: "user", content: "ping" }],
        config: { engines: { "codex-plus": { auth_path: authPath, ...engineCfg } } },
      });
      await call("codex-plus:gpt-5.6-luna@medium");
      await call("codex-plus:gpt-5.6-luna", { reasoning_effort: "low" });
      await call("codex-plus:gpt-5.6-luna");
      assert.equal(sent[0].model, "gpt-5.6-luna");
      assert.deepEqual(sent[0].reasoning, { effort: "medium", summary: "auto" });
      assert.deepEqual(sent[1].reasoning, { effort: "low", summary: "auto" });
      assert.equal(sent[2].reasoning, undefined, "unset leaves the backend default alone");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
