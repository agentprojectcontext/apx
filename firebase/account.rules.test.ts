import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountProfiles } from "../apps/core/src/account/profile.ts";

const project = "demo-apx-account";
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error("Run with firebase emulators:exec --only firestore --project demo-apx-account");
const origin = `http://${host}`;
const database = `projects/${project}/databases/(default)`;
const root = `${origin}/v1/${database}/documents`;
const profiles = createAccountProfiles({ project, origin });
const token = (uid: string) => {
  const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${json({ alg: "none", typ: "JWT" })}.${json({
    sub: uid,
    user_id: uid,
    aud: project,
    iss: `https://securetoken.google.com/${project}`,
    iat: 1,
    exp: 4102444800,
    firebase: { sign_in_provider: "google.com", identities: {} },
  })}.`;
};
const field = (value: string) => ({ stringValue: value });
async function call(uid: string | undefined, path: string, body?: unknown, method?: string) {
  return fetch(`${root}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { ...(uid ? { authorization: `Bearer ${token(uid)}` } : {}), "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("account profiles and reservations enforce ownership, stable ids and atomic unique handles", async () => {
  const clear = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: "DELETE" });
  assert.equal(clear.status, 200);
  const first = await profiles.ensure("first", token("first"), "Acme", "https://example.com/photo.png");
  const second = await profiles.ensure("second", token("second"), "Northwind", "");
  assert.match(first.id, /^[0-9a-hjkmnp-tv-z]{8}$/);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(await profiles.ensure("first", token("first"), "New name", ""), first);
  assert.equal((await call("first", "/users/first")).status, 200);
  for (const uid of [undefined, "second"]) {
    assert.equal((await call(uid, "/users/first")).status, 403);
    assert.equal((await call(uid, `/accountIds/${first.id}`)).status, 403);
  }
  assert.equal((await call("first", "/users")).status, 403);
  assert.equal((await call("first", "/users/first", undefined, "DELETE")).status, 403);

  const named = await profiles.rename("first", token("first"), "@Acme");
  assert.equal(named.handle, "acme");
  await assert.rejects(profiles.rename("second", token("second"), "acme"), /handle_unavailable/);
  await assert.rejects(profiles.rename("first", token("first"), "a/b"), /invalid_handle/);
  assert.equal((await call("second", "/accountHandles/acme")).status, 403);
  assert.equal((await call("first", "/accountHandles")).status, 403);
  const updated = await profiles.rename("first", token("first"), "renamed");
  assert.equal(updated.id, first.id);
  assert.equal((await profiles.rename("second", token("second"), "acme")).handle, "acme");
  assert.equal((await profiles.rename("first", token("first"), "")).handle, "");

  const changeId = await call("first", ":commit", {
    writes: [
      {
        update: {
          name: `${database}/documents/users/first`,
          fields: {
            id: field(second.id),
            name: field("Acme"),
            photo: field(""),
            handle: field(""),
          },
        },
      },
    ],
  });
  assert.equal(changeId.status, 403);
  const steal = await call("first", ":commit", {
    writes: [{ update: { name: `${database}/documents/accountIds/${second.id}`, fields: { uid: field("first") } } }],
  });
  assert.equal(steal.status, 403);
  const orphan = await call("first", ":commit", {
    writes: [{ update: { name: `${database}/documents/accountHandles/orphan`, fields: { uid: field("first") } } }],
  });
  assert.equal(orphan.status, 403);
  const extra = await call("first", ":commit", {
    writes: [
      {
        update: {
          name: `${database}/documents/users/first`,
          fields: {
            id: field(first.id),
            name: field("Acme"),
            photo: field(""),
            handle: field(""),
            admin: { booleanValue: true },
          },
        },
      },
    ],
  });
  assert.equal(extra.status, 403);
  const race = await Promise.allSettled([
    profiles.rename("first", token("first"), "shared"),
    profiles.rename("second", token("second"), "shared"),
  ]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);
});
