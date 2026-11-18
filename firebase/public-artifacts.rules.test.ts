import assert from "node:assert/strict";
import { test } from "node:test";
import { metadataCloud } from "../apps/artifact-worker/src/metadata.ts";
import { publicArtifactCopy } from "../apps/core/src/domain/public-artifact-copy.ts";

const project = "demo-apx-artifacts";
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error("Run using the isolated Firestore emulator");
const origin = `http://${host}`;
const database = `projects/${project}/databases/(default)`;
const root = `${origin}/v1/${database}/documents`;
const token = (uid: string) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    sub: uid,
    user_id: uid,
    aud: project,
    iss: `https://securetoken.google.com/${project}`,
    iat: 1,
    exp: 4102444800,
    firebase: { sign_in_provider: "google.com", identities: {} },
  })}.`;
};
const first = metadataCloud({ uid: "first", idToken: token("first") }, { project, origin });
const second = metadataCloud({ uid: "second", idToken: token("second") }, { project, origin });
const copy = publicArtifactCopy({ name: "orders", title: "Orders", html: "<h1>Orders</h1>", version: 1, app: true });
const meta = { title: copy.bundle.manifest.title, bytes: copy.bytes, sha256: copy.sha256 };
const code = "abcd1234";
const field = (value: string) => ({ stringValue: value });
const name = (path: string) => `${database}/documents/${path}`;
async function call(uid: string | undefined, path: string, body?: unknown) {
  return fetch(`${root}${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(uid ? { authorization: `Bearer ${token(uid)}` } : {}), "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function clear() {
  const response = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: "DELETE" });
  assert.equal(response.status, 200);
}

test("only the authenticated owner can read or mutate private metadata; no public content or parts remain in Firestore", async () => {
  await clear();
  assert.equal(await first.available(code), true);
  assert.equal((await call(undefined, `/artifactOwners/${code}`)).status, 403);
  const slot = await first.reserve(code, meta);
  assert.equal(slot, "0");
  assert.equal(await first.available(code), false);
  assert.equal(await second.available(code), false);
  const published = await first.get(code);
  assert.deepEqual(Object.keys(published.fields).sort(), ["bytes", "sha256", "title", "updated_at"]);
  assert.equal(published.fields.sha256?.stringValue, copy.sha256);
  for (const uid of [undefined, "second"]) {
    for (const path of [
      `/publicArtifacts/${code}`,
      `/artifactOwners/${code}`,
      "/artifactAccounts/first/slots",
      "/artifactAccounts/first/slots/0",
    ])
      assert.equal((await call(uid, path)).status, 403);
    assert.equal((await call(uid, ":commit", { writes: [{ delete: name(`publicArtifacts/${code}`) }] })).status, 403);
  }
  for (const uid of [undefined, "first", "second"]) {
    assert.equal((await call(uid, "/publicArtifacts")).status, 403);
    assert.equal((await call(uid, `/publicArtifacts/${code}/parts/0`)).status, 403);
    assert.equal((await call(uid, `/publicArtifacts/${code}/parts`)).status, 403);
    assert.equal(
      (
        await call(uid, ":commit", {
          writes: [{ update: { name: name(`publicArtifacts/${code}/parts/0`), fields: { data: field("YQ==") } } }],
        })
      ).status,
      403,
    );
  }
  await assert.rejects(second.get(code), /access_denied/);
  await assert.rejects(second.reserve(code, meta), /changed|access_denied/);
  await assert.rejects(second.release(code, slot), /access_denied/);
  assert.equal(
    (await call("first", ":commit", { writes: [{ delete: name("artifactAccounts/first/slots/0") }] })).status,
    403,
  );
  const orphan = {
    writes: [{ update: { name: name("artifactOwners/rphan000"), fields: { uid: field("first"), slot: field("1") } } }],
  };
  assert.equal((await call("first", ":commit", orphan)).status, 403);
  await first.release(code, slot);
  assert.deepEqual(await first.slots(), []);
  assert.equal(await first.available(code), false, "a revoked code remains permanently reserved");
  await assert.rejects(first.reserve(code, meta), /changed|access_denied/);
});

test("racing metadata reservations cannot exceed twenty slots or steal a code", async () => {
  await clear();
  for (let i = 0; i < 19; i++) await first.reserve(`000000${String(i).padStart(2, "0")}`, meta);
  const race = await Promise.allSettled([first.reserve("race0001", meta), first.reserve("race0002", meta)]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await first.slots()).length, 20);
  await assert.rejects(first.reserve("max00000", meta), /limit/);
  await assert.rejects(second.reserve("00000000", meta), /changed|access_denied/);
  assert.equal((await second.slots()).length, 0);
  const forged = {
    writes: [{ update: { name: name("artifactAccounts/first/slots/20"), fields: { code: field("extra000") } } }],
  };
  assert.equal((await call("first", ":commit", forged)).status, 403);
});

test("metadata updates enforce size, hash, timestamp and shape, rejecting HTML and every former chunk field", async () => {
  await clear();
  await first.reserve(code, meta);
  const published = await first.get(code);
  const { updated_at: _timestamp, ...fields } = published.fields;
  for (const change of [
    { html: field("<h1>private</h1>") },
    { data: field("content") },
    { chunk_count: { integerValue: "1" } },
    { bytes: { integerValue: "4200001" } },
    { bytes: { integerValue: "0" } },
    { sha256: field("not-a-hash") },
    { title: field("") },
  ]) {
    assert.equal(
      (
        await call("first", ":commit", {
          writes: [
            {
              update: { name: name(`publicArtifacts/${code}`), fields: { ...fields, ...change } },
              updateTransforms: [{ fieldPath: "updated_at", setToServerValue: "REQUEST_TIME" }],
            },
          ],
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await call("first", ":commit", {
        writes: [{ update: { name: name(`publicArtifacts/${code}`), fields: published.fields } }],
      })
    ).status,
    403,
  );
  await first.reserve(code, { ...meta, bytes: 4_200_000 });
  assert.equal((await first.get(code)).fields.bytes?.integerValue, "4200000");
  await first.reserve(code, meta);
  assert.equal((await first.get(code)).fields.bytes?.integerValue, String(copy.bytes));
});

test("retrying a lost metadata response retains one slot without pretending content was uploaded", async () => {
  await clear();
  let drop = true;
  const interrupted = metadataCloud(
    { uid: "first", idToken: token("first") },
    {
      project,
      origin,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (String(input).endsWith(":commit") && response.ok && drop) {
          drop = false;
          throw new Error("response lost after commit");
        }
        return response;
      },
    },
  );
  await assert.rejects(interrupted.reserve(code, meta), /response lost/);
  assert.equal(await interrupted.reserve(code, meta), "0");
  assert.equal((await first.slots()).length, 1);
  assert.equal((await first.get(code)).fields.sha256?.stringValue, copy.sha256);
});
