import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { createPublicationDrafts, type PublicationAccount } from "./drafts.ts";
import type { createPublicArtifactCloud } from "./firestore.ts";

function fixture() {
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
  const drafts = createPublicationDrafts({
    account: connection,
    cloud,
    source: () => source,
    decorateHtml: (html) => html,
    now: () => now,
  });
  return {
    drafts,
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
  f.advance(10 * 60_000);
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
