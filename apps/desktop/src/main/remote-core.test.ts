import assert from "node:assert/strict";
import { test } from "node:test";
import { updateRemoteCore } from "./remote-core.ts";

type Call = { method: string; idem: boolean };

function fakeCore(updates: object, update: object, calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const method = String(input).split("/rpc/")[1] ?? "";
    calls.push({ method, idem: Boolean((init?.headers as Record<string, string>)?.["idempotency-key"]) });
    const result = method === "system.updates" ? updates : method === "system.update" ? update : { name: "apx-core" };
    return new Response(JSON.stringify({ ok: true, result }));
  }) as typeof fetch;
}

test("a server behind on a release updates first, with an idempotency key, and is waited for", async () => {
  const calls: Call[] = [];
  const f = fakeCore({ behind: 1, source: "release" }, { ok: true, restart: true }, calls);
  assert.equal(await updateRemoteCore("http://127.0.0.1:7440", f, 5000), true);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["system.updates", "system.update", "system.health"],
  );
  assert.equal(calls[1]?.idem, true);
});

test("an up-to-date server, a checkout or no server at all is left alone", async () => {
  const calls: Call[] = [];
  assert.equal(await updateRemoteCore(undefined, fakeCore({}, {}, calls)), false);
  assert.equal(await updateRemoteCore("http://s", fakeCore({ behind: 0, source: "release" }, {}, calls)), false);
  assert.equal(await updateRemoteCore("http://s", fakeCore({ behind: 3, source: "git" }, {}, calls)), false);
  assert.ok(!calls.some((c) => c.method === "system.update"));
});
