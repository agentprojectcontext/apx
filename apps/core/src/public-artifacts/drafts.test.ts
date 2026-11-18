import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { createPublicationDrafts, type PublicationAccount } from "./drafts.ts";
import type { createPublicArtifactCloud } from "./firestore.ts";

function fixture(codes?: () => string) {
  let now = 0;
  const account = { uid: "first", generation: 1 };
  let source:
    | { name: string; title: string; html: string; version: number; app: boolean; state: Record<string, unknown> }
    | undefined = {
    name: "orders",
    title: "Orders",
    html: "<h1>Orders</h1>",
    version: 1,
    app: false,
    state: { chosen: "open", private: "never uploaded" },
  };
  const writes: { action: string; code: string; json?: string; expected?: string }[] = [];
  const connection: PublicationAccount = {
    async withSession(work) {
      const uid = account.uid;
      const generation = account.generation;
      return work({
        uid,
        generation,
        idToken: "emulated-token",
        current: () => account.uid === uid && account.generation === generation,
      });
    },
  };
  const cloud: ReturnType<typeof createPublicArtifactCloud> = {
    available: async () => true,
    slots: async () => [],
    inspect: async (_session, code) => ({
      name: code,
      fields: { title: { stringValue: "Orders" }, bytes: { integerValue: "5" } },
      updateTime: "revision-1",
    }),
    publish: async (_session, code, copy) => {
      writes.push({ action: "publish", code, json: copy.json });
      return { code, sha256: copy.sha256 };
    },
    update: async (_session, code, copy, expected) => {
      writes.push({ action: "update", code, json: copy.json, expected });
      return { code, sha256: copy.sha256 };
    },
    revoke: async (_session, code, expected) => {
      writes.push({ action: "revoke", code, expected });
      return { ok: true };
    },
  };
  let saved: import("./drafts.ts").PublicationDraftSnapshot[] = [];
  const create = () =>
    createPublicationDrafts({
      persistence: {
        load: () => saved,
        save: (value) => {
          saved = structuredClone([...value]);
        },
      },
      account: connection,
      cloud,
      code: codes,
      source: () => source,
      decorateHtml: (html) => html,
      now: () => now,
    });
  const drafts = create();
  return {
    drafts,
    restart: create,
    persisted: () => saved,
    cloud,
    account,
    writes,
    get source() {
      return source;
    },
    removeSource: () => {
      source = undefined;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("durable cards survive waiting and restart but require a fresh human review", async () => {
  const f = fixture();
  const prepared = await f.drafts.prepare({ action: "publish", surface: "surface" });
  assert.equal(await f.drafts.verifyReview(prepared.draft, "invented"), false);
  const preview = await f.drafts.preview(prepared.draft);
  assert.equal(await f.drafts.verifyReview(prepared.draft, preview.review_token), true);
  assert.equal(JSON.stringify(f.persisted()).includes(preview.review_token), false);
  assert.equal(JSON.stringify(f.persisted()).includes("emulated-token"), false);
  assert.equal(JSON.stringify(f.drafts.describe(prepared.draft)).includes(preview.review_token), false);
  f.advance(11 * 60_000);
  const restored = f.restart();
  assert.equal(await restored.verifyReview(prepared.draft, preview.review_token), false);
  await assert.rejects(restored.commit(prepared.draft), /review_required/);
  const fresh = await restored.preview(prepared.draft);
  assert.notEqual(fresh.review_token, preview.review_token);
  assert.equal(await restored.verifyReview(prepared.draft, fresh.review_token), true);
  assert.ok(f.source);
  f.source.html = "changed";
  assert.equal(await restored.verifyReview(prepared.draft, fresh.review_token), false);
  await assert.rejects(restored.commit(prepared.draft), /source_changed/);
  assert.equal(f.writes.length, 0);
});

test("restart cannot cross account boundaries and live review tokens cannot survive logout", async () => {
  const f = fixture();
  const prepared = await f.drafts.prepare({ action: "publish", surface: "surface" });
  const preview = await f.drafts.preview(prepared.draft);
  f.account.generation++;
  assert.equal(await f.drafts.verifyReview(prepared.draft, preview.review_token), false);
  await assert.rejects(f.drafts.preview(prepared.draft), /account_changed/);
  const restored = f.restart();
  f.account.uid = "second";
  await assert.rejects(restored.preview(prepared.draft), /account_changed/);
  assert.equal(await restored.verifyReview(prepared.draft, preview.review_token), false);
  assert.equal(f.writes.length, 0);
});

test("durable drafts retain at most twenty selected snapshots", async () => {
  const f = fixture();
  for (let index = 0; index < 20; index++) {
    await f.drafts.prepare({ action: "publish", surface: `surface-${index}` });
  }
  await assert.rejects(f.drafts.prepare({ action: "publish", surface: "overflow" }), /preview_limit/);
  assert.equal(f.persisted().length, 20);
  assert.equal(JSON.stringify(f.persisted()).includes("never uploaded"), false);
  const restored = f.restart();
  const first = f.persisted()[0];
  assert.ok(first);
  assert.equal(restored.describe(first.id).code, first.code);
});

test("preparation retries occupied codes before presenting an immutable URL", async () => {
  const codes = ["00000000", "00000001", "00000002"];
  const f = fixture(() => codes.shift() ?? "00000003");
  let attempts = 0;
  f.cloud.available = async () => ++attempts > 2;
  const prepared = await f.drafts.prepare({ action: "publish", surface: "surface" });
  assert.equal(attempts, 3);
  assert.equal(prepared.code, "00000002");
  assert.equal((await f.drafts.preview(prepared.draft)).code, prepared.code);
  await f.drafts.commit(prepared.draft);
  assert.equal(f.writes[0]?.code, prepared.code);
  f.cloud.available = async () => false;
  await assert.rejects(f.drafts.prepare({ action: "publish", surface: "surface" }), /code_unavailable/);
});

test("preparing and previewing cannot publish; the immutable receipt never reveals account credentials", async () => {
  const f = fixture();
  const prepared = await f.drafts.prepare({ action: "publish", surface: "surface", state_keys: ["chosen"] });
  assert.equal(f.writes.length, 0);
  assert.match(prepared.code, /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/);
  const preview = await f.drafts.preview(prepared.draft);
  assert.deepEqual(preview.bundle?.state, { chosen: "open" });
  assert.ok(preview.bundle);
  preview.bundle.manifest.title = "Mutated preview";
  if (preview.bundle.state) preview.bundle.state.chosen = "Mutated state";
  const receipt = await f.drafts.commit(prepared.draft);
  assert.equal(f.writes.length, 1);
  assert.equal(JSON.parse(f.writes[0]?.json ?? "{}").manifest.title, "Orders");
  assert.deepEqual(JSON.parse(f.writes[0]?.json ?? "{}").state, { chosen: "open" });
  assert.equal(JSON.stringify([prepared, preview, receipt]).includes("emulated-token"), false);
  assert.equal(JSON.stringify([prepared, preview, receipt]).includes('"uid"'), false);
  assert.deepEqual(await f.drafts.commit(prepared.draft), receipt);
  assert.equal(f.writes.length, 1);
});

test("source edits, missing sources, changed accounts and logout invalidate an approved snapshot", async () => {
  for (const change of ["html", "state", "remove", "account", "logout"] as const) {
    const f = fixture();
    const draft = await f.drafts.prepare({ action: "publish", surface: "surface", state_keys: ["chosen"] });
    assert.ok(f.source);
    if (change === "html") f.source.html = "<h1>Changed</h1>";
    if (change === "state") f.source.state.chosen = "closed";
    if (change === "remove") f.removeSource();
    if (change === "account") f.account.uid = "second";
    if (change === "logout") f.account.generation++;
    await assert.rejects(f.drafts.commit(draft.draft), /source_changed|source_missing|account_changed/);
    assert.equal(f.writes.length, 0);
  }
});

test("an expired or superseded preview cannot run, and pending copies omit state by default", async () => {
  const f = fixture();
  const first = await f.drafts.prepare({ action: "publish", surface: "surface", state_keys: ["chosen"] });
  const second = await f.drafts.prepare({ action: "publish", surface: "surface" });
  await assert.rejects(f.drafts.commit(first.draft), /preview_expired/);
  assert.equal((await f.drafts.preview(second.draft)).bundle?.state, undefined);
  f.advance(30 * 24 * 60 * 60_000);
  await assert.rejects(f.drafts.preview(second.draft), /preview_expired/);
  await assert.rejects(f.drafts.commit(second.draft), /preview_expired/);
  assert.equal(f.writes.length, 0);
});

test("update and revocation bind the account's remote revision without requiring a remaining local source", async () => {
  const f = fixture();
  const update = await f.drafts.prepare({ action: "update", code: "abcd1234", surface: "surface" });
  await f.drafts.commit(update.draft);
  assert.equal(f.writes[0]?.action, "update");
  assert.equal(f.writes[0]?.expected, "revision-1");
  f.removeSource();
  const revoke = await f.drafts.prepare({ action: "revoke", code: "abcd1234" });
  assert.equal(revoke.title, "Orders");
  assert.equal((await f.drafts.preview(revoke.draft)).bundle, undefined);
  await f.drafts.commit(revoke.draft);
  assert.deepEqual(f.writes[1], { action: "revoke", code: "abcd1234", expected: "revision-1" });
});

test("concurrent approvals share one write, and sign-out discards a completed in-flight response", async () => {
  const f = fixture();
  const gate = Promise.withResolvers<void>();
  f.cloud.publish = async (_session, code, copy) => {
    f.writes.push({ action: "publish", code, json: copy.json });
    await gate.promise;
    return { code, sha256: copy.sha256 };
  };
  const prepared = await f.drafts.prepare({ action: "publish", surface: "surface" });
  const one = f.drafts.commit(prepared.draft);
  const two = f.drafts.commit(prepared.draft);
  const results = Promise.allSettled([one, two]);
  await waitFor(() => f.writes.length === 1, "one publication write");
  f.account.generation++;
  gate.resolve();
  const settled = await results;
  for (const result of settled) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.match(String(result.reason), /account_changed/);
  }
  assert.equal(f.writes.length, 1);
});
