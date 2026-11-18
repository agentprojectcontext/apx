import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { createTokenVerifier } from "./auth.ts";

const now = 1_800_000_000_000;
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
if (!("publicKey" in pair)) throw new Error("Expected an RSA key pair");
const privateKey = pair.privateKey;
const publicKey = {
  ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const head = encode({ alg: "RS256", kid: "test-key", ...header });
  const payload = encode({
    aud: "apx-agents",
    iss: "https://securetoken.google.com/apx-agents",
    sub: "person",
    exp: now / 1000 + 3600,
    iat: now / 1000,
    auth_time: now / 1000,
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${head}.${payload}`),
  );
  return `${head}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}
function fixture() {
  let requests = 0;
  const verify = createTokenVerifier({
    project: "apx-agents",
    now: () => now,
    fetch: async (input, init) => {
      requests++;
      assert.equal(
        String(input),
        "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
      );
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      assert.equal(init?.redirect, "manual");
      return Response.json({ keys: [publicKey] }, { headers: { "cache-control": "max-age=3600" } });
    },
  });
  return { verify, requests: () => requests };
}

test("verifies Google's signature and pinned claims, reuses public keys and exposes no token to Google", async () => {
  const f = fixture();
  const value = await token();
  assert.deepEqual(await f.verify(`Bearer ${value}`), { uid: "person", idToken: value });
  assert.equal((await f.verify(`Bearer ${value}`)).uid, "person");
  assert.equal(f.requests(), 1);
});

test("rejects other audiences, issuers, expired and future tokens, bad subjects and unsupported algorithms", async () => {
  const f = fixture();
  for (const claims of [
    { aud: "other-project" },
    { iss: "https://example.com" },
    { exp: now / 1000 },
    { iat: now / 1000 + 1 },
    { auth_time: now / 1000 + 1 },
    { sub: "" },
    { sub: "other/person" },
    { nbf: now / 1000 + 1 },
  ])
    await assert.rejects(f.verify(`Bearer ${await token(claims)}`), /sign_in_required/);
  for (const header of [{ alg: "none" }, { alg: "HS256" }, { crit: ["exp"] }])
    await assert.rejects(f.verify(`Bearer ${await token({}, header)}`), /sign_in_required/);
  assert.equal(f.requests(), 0);
});

test("forged signatures and unknown keys never authenticate; failures of Google fail closed", async () => {
  const f = fixture();
  const value = await token();
  const parts = value.split(".");
  parts[1] = encode({ sub: "other" });
  await assert.rejects(f.verify(`Bearer ${parts.join(".")}`), /sign_in_required/);
  await assert.rejects(
    f.verify(`Bearer ${await token({}, { kid: "unknown", jku: "https://example.com/key" })}`),
    /sign_in_required/,
  );
  await assert.rejects(f.verify(`Bearer ${value.slice(0, -8)}AAAAAAAA`), /sign_in_required/);
  const offline = createTokenVerifier({
    project: "apx-agents",
    now: () => now,
    fetch: async () => new Response(null, { status: 503 }),
  });
  await assert.rejects(offline(`Bearer ${value}`), /unavailable/);
  await assert.rejects(f.verify(null), /sign_in_required/);
});

test("unknown key IDs refresh a stale key set once on an injected clock, without trusting token-supplied URLs", async () => {
  let current = now;
  let calls = 0;
  let rotated = false;
  const verify = createTokenVerifier({
    project: "apx-agents",
    now: () => current,
    fetch: async () => {
      calls++;
      return Response.json(
        { keys: [{ ...publicKey, kid: rotated ? "next-key" : "test-key" }] },
        { headers: { "cache-control": "max-age=3600" } },
      );
    },
  });
  await verify(`Bearer ${await token()}`);
  rotated = true;
  current += 60_001;
  const next = `Bearer ${await token({}, { kid: "next-key" })}`;
  assert.deepEqual(
    (await Promise.all([verify(next), verify(next)])).map((value) => value.uid),
    ["person", "person"],
  );
  assert.equal(calls, 2);
  await assert.rejects(
    verify(`Bearer ${await token({}, { kid: "unknown", jku: "https://example.com/key" })}`),
    /sign_in_required/,
  );
  assert.equal(calls, 2);
});
