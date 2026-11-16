import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { createOpenRouterLogin } from "./openrouter-login.ts";

/** OpenRouter's key exchange as a fake: it answers only the verifier whose S256 challenge it was shown. */
function fakeOpenRouter() {
  const seen: Array<Record<string, string>> = [];
  let challenge = "";
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    seen.push(body);
    const ok =
      crypto
        .createHash("sha256")
        .update(body.code_verifier ?? "")
        .digest("base64url") === challenge;
    return new Response(JSON.stringify(ok ? { key: "sk-or-acme" } : { error: "bad" }), { status: ok ? 200 : 403 });
  }) as typeof fetch;
  return { fetcher, seen, show: (url: string) => (challenge = new URL(url).searchParams.get("code_challenge") ?? "") };
}

test("the approval page carries an S256 challenge and a callback that keeps the state", () => {
  const login = createOpenRouterLogin();
  const { url } = login.start("http://127.0.0.1:7440/oauth/openrouter");
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://openrouter.ai/auth");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  const back = new URL(u.searchParams.get("callback_url") ?? "");
  assert.equal(back.pathname, "/oauth/openrouter");
  assert.ok(back.searchParams.get("state"));
  assert.throws(() => login.start("javascript:alert(1)"), /http/);
});

test("the code becomes the account's key once, with the verifier this core kept", async () => {
  const fake = fakeOpenRouter();
  const login = createOpenRouterLogin({ fetch: fake.fetcher });
  const { url } = login.start("http://127.0.0.1:7440/oauth/openrouter");
  fake.show(url);
  const state = new URL(new URL(url).searchParams.get("callback_url") ?? "").searchParams.get("state") ?? "";
  assert.equal(await login.finish("code-1", state), "sk-or-acme");
  assert.equal(fake.seen[0]?.code, "code-1");
  await assert.rejects(login.finish("code-1", state), /expired or was already used/);
  await assert.rejects(login.finish("code-2", "forged"), /expired or was already used/);
});

test("a sign-in left more than ten minutes no longer finishes", async () => {
  let now = 0;
  const fake = fakeOpenRouter();
  const login = createOpenRouterLogin({ fetch: fake.fetcher, now: () => now });
  const { url } = login.start("http://127.0.0.1:7440/oauth/openrouter");
  const state = new URL(new URL(url).searchParams.get("callback_url") ?? "").searchParams.get("state") ?? "";
  now = 11 * 60_000;
  await assert.rejects(login.finish("code", state), /expired/);
  assert.equal(fake.seen.length, 0);
});
