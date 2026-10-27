import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { createPublicCredentials } from "./public-credentials.ts";
import { listenHooks } from "./transport/hooks.ts";

test("each public route requires its own secure, rotatable and revocable credential", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  let endpoints = [
    { path: "/flows/acme", label: "Acme" },
    { path: "/flows/northwind", label: "Northwind" },
  ];
  const make = () =>
    createPublicCredentials({ store: env.core.store, secrets: env.core.secrets, endpoints: () => endpoints });
  const credentials = make();
  let calls = 0;
  const server = await listenHooks({
    port: 0,
    log: { info() {}, warn() {}, error() {} },
    routes: credentials.protect((pathname) => ({
      id: pathname.slice(1),
      methods: ["POST"],
      authorize: () => true,
      handle: async (request) => {
        assert.equal(request.headers.authorization, undefined, "credentials never reach the Flow service");
        assert.equal(request.headers.cookie, undefined);
        calls++;
        return { status: 202 };
      },
    })),
  });
  const send = (pathname: string, token?: string) =>
    fetch(`http://127.0.0.1:${server.port}${pathname}`, {
      method: "POST",
      body: "{}",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const tokenOf = (ref: string) => {
    const value = env.core.secrets.resolve(ref);
    assert.ok(value);
    return value;
  };
  try {
    assert.equal((await send("/flows/acme")).status, 401);
    assert.throws(() => credentials.rotate("/rpc/threads.send"), /registered/);
    assert.throws(() => credentials.rotate("/flows/unknown"), /registered/);
    const first = credentials.rotate("/flows/acme");
    const token = tokenOf(first.secret_ref);
    assert.match(token, /^apxp_[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(first).includes(token), false, "idempotency responses contain references only");
    assert.equal(env.core.store.settings.get("public-route-credentials")?.includes(token), false);
    assert.equal((await send("/flows/acme", "wrong")).status, 401);
    assert.equal((await send("/flows/acme", token)).status, 202);
    assert.equal((await send("/flows/northwind", token)).status, 401, "a token cannot cross integrations");
    assert.equal(
      make().authorize("/flows/acme", { authorization: `Bearer ${token}` }),
      true,
      "references survive service recreation",
    );
    const second = credentials.rotate("/flows/acme");
    const next = tokenOf(second.secret_ref);
    assert.notEqual(next, token);
    assert.equal(env.core.secrets.resolve(first.secret_ref), undefined, "old secret removed");
    assert.equal((await send("/flows/acme", token)).status, 401);
    assert.equal((await send("/flows/acme", next)).status, 202);
    assert.equal(credentials.list()[0]?.enabled, true);
    credentials.revoke("/flows/acme");
    assert.equal((await send("/flows/acme", next)).status, 401);
    assert.equal(credentials.list()[0]?.enabled, false);
    assert.equal(env.core.secrets.resolve(second.secret_ref), undefined);
    assert.equal(calls, 2);
    const third = credentials.rotate("/flows/acme");
    const last = tokenOf(third.secret_ref);
    endpoints = [];
    assert.equal((await send("/flows/acme", last)).status, 404, "removing the destination removes the public route");
    assert.equal(credentials.authorize("/flows/acme", { authorization: `Bearer ${last}` }), false);
    credentials.revoke("/flows/acme");
  } finally {
    await server.close();
    await env.core.close();
    await env.cleanup();
  }
});

test("public credential management stays owner-only behind the private RPC", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    assert.deepEqual(await env.client.call("public_routes.list", {}), { routes: [] });
    await assert.rejects(env.client.call("public_routes.rotate", { path: "/flows/missing" }), /registered/);
    const response = await fetch(`${env.core.url}/rpc/public_routes.list`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-apx-actor": "agent" },
      body: "{}",
    });
    assert.equal(response.status, 401);
    assert.equal((await env.client.call("public_routes.revoke", { path: "/flows/missing" })).revoked, true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
