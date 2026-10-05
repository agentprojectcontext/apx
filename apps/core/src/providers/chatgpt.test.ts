import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createSecrets } from "../secrets.ts";
import { createChatgptLogin } from "./chatgpt-login.ts";
import { toInput } from "./chatgpt-responses.ts";
import { createLlm } from "./llm.ts";

const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const account = { "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } };

/** A fake of both ends: OpenAI's sign-in (device code, token) and the plan's Responses API. */
const seen: Array<{ url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
let polls = 0;
let refreshes = 0;
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    const body = (raw.startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))) as Record<
      string,
      unknown
    >;
    seen.push({ url: req.url ?? "", headers: req.headers, body });
    const json = (status: number, j: object) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(j));
    if (req.url === "/api/accounts/deviceauth/usercode")
      return json(200, { user_code: "ABCD-1234", device_auth_id: "dev-1", interval: 1 });
    if (req.url === "/api/accounts/deviceauth/token")
      return ++polls < 2 ? json(403, {}) : json(200, { authorization_code: "code-1", code_verifier: "ver-1" });
    if (req.url === "/oauth/token") {
      if (body.grant_type === "refresh_token") refreshes++;
      const exp = Math.floor(Date.now() / 1000) + 3600;
      return json(200, { access_token: jwt({ ...account, exp }), refresh_token: `r-${refreshes}` });
    }
    if (req.url === "/codex/responses") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (e: object) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      const afterTool = (body.input as Array<{ type: string }>).some((i) => i.type === "function_call_output");
      if (afterTool) {
        send({ type: "response.output_text.delta", delta: "Three " });
        send({ type: "response.output_text.delta", delta: "tasks." });
      } else {
        send({
          type: "response.output_item.done",
          item: { type: "reasoning", summary: [], encrypted_content: "enc-1" },
        });
        send({
          type: "response.output_item.added",
          item: { id: "fc1", type: "function_call", call_id: "call-1", name: "task_list" },
        });
        send({ type: "response.function_call_arguments.delta", item_id: "fc1", delta: '{"mine":' });
        send({ type: "response.function_call_arguments.delta", item_id: "fc1", delta: "true}" });
        send({
          type: "response.output_item.done",
          item: { id: "fc1", type: "function_call", call_id: "call-1", name: "task_list" },
        });
      }
      send({
        type: "response.completed",
        response: { status: "completed", usage: { input_tokens: 50, output_tokens: 5 } },
      });
      return res.end();
    }
    json(404, {});
  });
});
let base = "";
let dir = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-chatgpt-"));
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const secretsIn = (name: string) => {
  const home = path.join(dir, name);
  fs.mkdirSync(home, { recursive: true });
  return createSecrets(home, "file");
};

test("device sign-in: a code for the owner, then the core finishes it alone and keeps the tokens as a secret", async () => {
  const secrets = secretsIn("device");
  const login = createChatgptLogin({ secrets, issuer: base });
  const code = await login.start();
  assert.equal(code.user_code, "ABCD-1234");
  assert.equal(code.verification_url, `${base}/codex/device`);
  assert.equal(login.status().pending?.user_code, "ABCD-1234");
  const end = Date.now() + 15_000;
  while (!login.has() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  assert.ok(login.has(), "signed in once the owner approved");
  assert.equal(login.status().pending, undefined);
  const exchange = seen.find((s) => s.url === "/oauth/token" && s.body.grant_type === "authorization_code");
  assert.equal(exchange?.body.code_verifier, "ver-1");
  const c = await login.credentials();
  assert.equal(c.headers["chatgpt-account-id"], "acct-1");
  login.disconnect();
  assert.equal(login.has(), false);
});

test("a token close to expiry is refreshed once, even with calls racing, and v1's own sign-in is taken over as is", async () => {
  const secrets = secretsIn("refresh");
  const v1 = path.join(dir, "v1.json");
  const expired = jwt({ ...account, exp: Math.floor(Date.now() / 1000) + 30 });
  fs.writeFileSync(
    v1,
    JSON.stringify({ tokens: { access_token: expired, refresh_token: "r-0", account_id: "acct-1" } }),
  );
  const login = createChatgptLogin({ secrets, issuer: base });
  assert.ok(login.importV1(v1));
  assert.equal(fs.readFileSync(v1, "utf8").includes("r-0"), true, "v1's file is only read");
  const before = refreshes;
  const [a, b] = await Promise.all([login.credentials(), login.credentials()]);
  assert.equal(refreshes - before, 1);
  assert.equal(a.token, b.token);
  assert.notEqual(a.token, expired);
});

test("the plan's model runs in APX's loop: tools as functions, reasoning replayed to the same model, effort sent", async () => {
  const secrets = secretsIn("call");
  const login = createChatgptLogin({ secrets, issuer: base });
  const v1 = path.join(dir, "v1b.json");
  fs.writeFileSync(
    v1,
    JSON.stringify({ tokens: { access_token: jwt({ ...account, exp: 9_999_999_999 }), refresh_token: "r" } }),
  );
  login.importV1(v1);
  const llm = createLlm({
    providers: () => [
      { id: "chatgpt", transport: "chatgpt-responses", base_url: `${base}/codex`, key: "oauth:chatgpt", models: [] },
    ],
    secrets,
    firstByteMs: 5000,
    signIns: { "oauth:chatgpt": login },
  });
  const tools = [
    {
      type: "function" as const,
      function: { name: "task_list", description: "tasks", parameters: { type: "object" } },
    },
  ];
  const messages = [
    { role: "system" as const, content: "You are Roby." },
    { role: "user" as const, content: "how many tasks?" },
  ];
  const first = await llm.complete({
    models: ["chatgpt/gpt-6-luna#high"],
    messages,
    tools,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(first.model, "chatgpt/gpt-6-luna");
  assert.equal(first.effort, "high");
  assert.deepEqual(first.message.tool_calls?.[0]?.function, { name: "task_list", arguments: '{"mine":true}' });
  const call = seen.filter((s) => s.url === "/codex/responses").at(-1);
  assert.equal(call?.headers["chatgpt-account-id"], "acct-1");
  assert.equal(call?.body.instructions, "You are Roby.");
  assert.equal(call?.body.store, false);
  assert.deepEqual(call?.body.reasoning, { effort: "high", summary: "auto" });
  assert.deepEqual(
    ((call?.body.tools ?? []) as Array<{ name: string }>).map((t) => t.name),
    ["task_list"],
  );

  const second = await llm.complete({
    models: ["chatgpt/gpt-6-luna"],
    messages: [...messages, first.message, { role: "tool", tool_call_id: "call-1", content: "3 tasks" }],
    tools,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(second.message.content, "Three tasks.");
  const input = seen.filter((s) => s.url === "/codex/responses").at(-1)?.body.input as Array<Record<string, unknown>>;
  assert.deepEqual(
    input.map((i) => i.type),
    ["message", "reasoning", "function_call", "function_call_output"],
    "the reasoning goes back before the call it produced",
  );
  // Another model never gets this one's reasoning.
  assert.ok(
    !toInput([...messages, first.message], "gpt-6-sol").input.some((i) => (i as { type: string }).type === "reasoning"),
  );
});
