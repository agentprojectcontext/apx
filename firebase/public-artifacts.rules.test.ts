import assert from "node:assert/strict";
import { test } from "node:test";
import { publicArtifactCopy } from "../apps/core/src/domain/public-artifact-copy.ts";
import {
  type CloudDocument,
  cloudNumber,
  cloudString,
  createPublicArtifactCloud,
} from "../apps/core/src/public-artifacts/firestore.ts";

const project = "demo-apx-artifacts";
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error("Run using the Firestore emulator and artifacts-emulator.json");
const origin = `http://${host}`;
const database = `projects/${project}/databases/(default)`;
const root = `${origin}/v1/${database}/documents`;
const cloud = createPublicArtifactCloud({ project, origin });
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
const first = { uid: "first", idToken: token("first") };
const second = { uid: "second", idToken: token("second") };
const surface = {
  name: "orders",
  title: "Orders",
  html: "<h1>Orders</h1>",
  version: 1,
  app: true,
  state: { tab: "open" },
};
const copy = publicArtifactCopy(surface, ["tab"]);
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

test("atomic publication is public only by code, privately owned, updateable and immediately revocable", async () => {
  await clear();
  assert.equal(await cloud.available(first, code), true);
  assert.equal((await call(undefined, `/artifactOwners/${code}`)).status, 403);
  assert.deepEqual(await cloud.publish(first, code, copy), { code, sha256: copy.sha256 });
  assert.equal(await cloud.available(first, code), false);
  assert.equal(await cloud.available(second, code), false);
  assert.deepEqual(await cloud.publish(first, code, copy), { code, sha256: copy.sha256 });
  assert.equal((await cloud.slots(first)).length, 1);
  const published = await cloud.inspect(first, code);
  assert.equal(cloudNumber(published, "chunk_count"), 1);
  assert.equal(cloudString(published, "sha256"), copy.sha256);
  for (const uid of [undefined, "first", "second"]) {
    const page = await call(uid, `/publicArtifacts/${code}`);
    assert.equal(page.status, 200);
    const data = await page.json();
    assert.equal(JSON.stringify(data).includes('"uid"'), false);
    const part = await call(uid, `/publicArtifacts/${code}/parts/0`);
    assert.equal(part.status, 200);
    assert.equal(
      Buffer.from(cloudString((await part.json()) as CloudDocument, "data"), "base64").toString("utf8"),
      copy.json,
    );
    assert.equal((await call(uid, "/publicArtifacts")).status, 403);
    assert.equal((await call(uid, `/publicArtifacts/${code}/parts`)).status, 403);
  }
  for (const uid of [undefined, "second"]) {
    assert.equal((await call(uid, `/artifactOwners/${code}`)).status, 403);
    assert.equal((await call(uid, "/artifactAccounts/first/slots")).status, 403);
    assert.equal((await call(uid, "/artifactAccounts/first/slots/0")).status, 403);
  }
  await assert.rejects(cloud.inspect(second, code), /access_denied/);
  await assert.rejects(cloud.update(second, code, copy, published.updateTime), /access_denied/);
  await assert.rejects(cloud.revoke(second, code, published.updateTime), /access_denied/);
  const standalonePart = {
    writes: [{ update: { name: name(`publicArtifacts/${code}/parts/0`), fields: { data: field("YQ==") } } }],
  };
  for (const uid of [undefined, "first", "second"])
    assert.equal((await call(uid, ":commit", standalonePart)).status, 403);
  const detachedSlot = { writes: [{ delete: name("artifactAccounts/first/slots/0") }] };
  assert.equal((await call("first", ":commit", detachedSlot)).status, 403);
  const detachedRoot = { writes: [{ delete: name(`publicArtifacts/${code}`) }] };
  assert.equal((await call("first", ":commit", detachedRoot)).status, 403);
  const orphan = {
    writes: [{ update: { name: name("artifactOwners/rphan000"), fields: { uid: field("first"), slot: field("1") } } }],
  };
  assert.equal((await call("first", ":commit", orphan)).status, 403);
  const next = publicArtifactCopy({ ...surface, title: "Updated orders" });
  await cloud.update(first, code, next, published.updateTime);
  await cloud.update(first, code, next, published.updateTime);
  await assert.rejects(cloud.update(first, code, copy, published.updateTime), /changed/);
  const updated = await cloud.inspect(first, code);
  assert.equal(cloudString(updated, "sha256"), next.sha256);
  await assert.rejects(cloud.revoke(first, code, published.updateTime), /changed/);
  await cloud.revoke(first, code, updated.updateTime);
  assert.deepEqual(await cloud.revoke(first, code, updated.updateTime), { ok: true });
  assert.equal((await call(undefined, `/publicArtifacts/${code}`)).status, 404);
  assert.equal((await call(undefined, `/publicArtifacts/${code}/parts/0`)).status, 403);
  assert.deepEqual(await cloud.slots(first), []);
  assert.equal(await cloud.available(first, code), false);
  assert.equal(await cloud.available(second, code), false);
  await assert.rejects(cloud.publish(first, code, copy), /changed|access_denied/);
  await assert.rejects(cloud.publish(second, code, copy), /changed|access_denied/);
});

test("racing reservations cannot exceed 20 active artifacts or steal another account's codes", async () => {
  await clear();
  for (let i = 0; i < 19; i++) await cloud.publish(first, `000000${String(i).padStart(2, "0")}`, copy);
  const race = await Promise.allSettled([
    cloud.publish(first, "race0001", copy),
    cloud.publish(first, "race0002", copy),
  ]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await cloud.slots(first)).length, 20);
  assert.deepEqual(await cloud.publish(first, "00000000", copy), { code: "00000000", sha256: copy.sha256 });
  await assert.rejects(cloud.publish(first, "max00000", copy), /limit/);
  const forged = {
    writes: [{ update: { name: name("artifactAccounts/first/slots/20"), fields: { code: field("extra000") } } }],
  };
  assert.equal((await call("first", ":commit", forged)).status, 403);
  await assert.rejects(cloud.publish(second, "00000000", copy), /changed|access_denied/);
  assert.equal((await cloud.slots(second)).length, 0);
});

test("multi-document copies update and shrink atomically, with strict chunk shape and size limits", async () => {
  await clear();
  const large = publicArtifactCopy({ ...surface, state: { text: "é".repeat(300_000) } }, ["text"]);
  await cloud.publish(first, code, large);
  const published = await cloud.inspect(first, code);
  assert.equal(cloudNumber(published, "chunk_count"), 2);
  const extraPart = {
    writes: [{ update: { name: name(`publicArtifacts/${code}/parts/8`), fields: { data: field("YQ==") } } }],
  };
  assert.equal((await call("first", ":commit", extraPart)).status, 403);
  const { updated_at: _time, ...fields } = published.fields;
  for (const data of ["A".repeat(700_001), "é", "not base64!"]) {
    const invalid = {
      writes: [
        {
          update: { name: name(`publicArtifacts/${code}`), fields },
          updateTransforms: [{ fieldPath: "updated_at", setToServerValue: "REQUEST_TIME" }],
        },
        { update: { name: name(`publicArtifacts/${code}/parts/0`), fields: { data: field(data) } } },
      ],
    };
    assert.equal((await call("first", ":commit", invalid)).status, 403);
  }
  const biggest = publicArtifactCopy({ ...surface, state: { text: "x".repeat(4_100_000) } }, ["text"]);
  await cloud.update(first, code, biggest, published.updateTime);
  const expanded = await cloud.inspect(first, code);
  assert.equal(cloudNumber(expanded, "chunk_count"), 8);
  await cloud.update(first, code, copy, expanded.updateTime);
  const reduced = await cloud.inspect(first, code);
  assert.equal(cloudNumber(reduced, "chunk_count"), 1);
  assert.equal((await call(undefined, `/publicArtifacts/${code}/parts/1`)).status, 404);
  await cloud.revoke(first, code, reduced.updateTime);
  assert.equal((await call(undefined, `/publicArtifacts/${code}/parts/0`)).status, 403);
});

test("a committed publication survives a lost response without creating another slot", async () => {
  await clear();
  let drop = true;
  const interrupted = createPublicArtifactCloud({
    project,
    origin,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (String(input).endsWith(":commit") && response.ok && drop) {
        drop = false;
        throw new Error("connection interrupted after commit");
      }
      return response;
    },
  });
  assert.deepEqual(await interrupted.publish(first, code, copy), { code, sha256: copy.sha256 });
  assert.equal(drop, false);
  assert.equal((await cloud.slots(first)).length, 1);
  assert.equal(cloudString(await cloud.inspect(first, code), "sha256"), copy.sha256);
});
