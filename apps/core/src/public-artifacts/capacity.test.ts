import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicArtifactCloud } from "./cloud.ts";
import { createPublicationDrafts, type PublicationDraftSnapshot, type PublicationSession } from "./drafts.ts";
import { publicationTransport } from "./test-cloud.ts";

function fixture() {
  let saved: readonly PublicationDraftSnapshot[] = [];
  const pending = new Set<string>();
  const session: PublicationSession = { uid: "person", idToken: "test-token", generation: 1, current: () => true };
  const cloud = createPublicArtifactCloud({ fetch: publicationTransport().fetch });
  const create = () =>
    createPublicationDrafts({
      account: { withSession: (work) => work(session) },
      cloud,
      source: (id) => ({ name: id, title: "Orders", html: "<h1>Orders</h1>", app: false, version: 1, state: {} }),
      decorateHtml: (html) => html,
      now: () => 1,
      pendingUntil: (id) => (pending.has(id) ? 100_000 : undefined),
      persistence: {
        load: () => saved,
        save: (drafts) => {
          saved = structuredClone(drafts);
        },
      },
    });
  return { drafts: create(), create, pending, saved: () => saved };
}

test("twenty completed publications do not consume revocation capacity, including after restart", async () => {
  const f = fixture();
  let code = "";
  for (let i = 0; i < 20; i++) {
    const draft = await f.drafts.prepare({ action: "publish", surface: `orders-${i}` });
    code = draft.code;
    await f.drafts.commit(draft.draft);
  }
  const restored = f.create();
  const revoke = await restored.prepare({ action: "revoke", code });
  await restored.preview(revoke.draft);
  await restored.commit(revoke.draft);
  assert.equal((await restored.list()).count, 19);
  assert.ok(f.saved().every((draft) => !draft.done || !draft.copy));
});

test("preparing the same source again preserves its completed idempotency receipt", async () => {
  const f = fixture();
  const first = await f.drafts.prepare({ action: "publish", surface: "orders" });
  const receipt = await f.drafts.commit(first.draft);
  const next = await f.drafts.prepare({ action: "publish", surface: "orders" });
  assert.notEqual(next.draft, first.draft);
  assert.deepEqual(await f.drafts.commit(first.draft), receipt);
  assert.equal((await f.drafts.list()).count, 1);
});

test("abandoned reviews cannot exhaust capacity and live cards survive replacement and reserved revocation", async () => {
  const f = fixture();
  const published = await f.drafts.prepare({ action: "publish", surface: "published" });
  await f.drafts.commit(published.draft);
  for (let i = 0; i < 20; i++) await f.drafts.prepare({ action: "publish", surface: `abandoned-${i}` });
  const first = await f.drafts.prepare({ action: "publish", surface: "new-review" });
  f.pending.add(first.draft);
  const second = await f.drafts.prepare({ action: "publish", surface: "new-review" });
  assert.notEqual(first.draft, second.draft);
  assert.equal(f.drafts.describe(first.draft).draft, first.draft);
  f.pending.add(second.draft);
  for (let i = 2; i < 20; i++) {
    const draft = await f.drafts.prepare({ action: "publish", surface: `pending-${i}` });
    f.pending.add(draft.draft);
  }
  await assert.rejects(f.drafts.prepare({ action: "publish", surface: "overflow" }), /preview_limit/);
  const restored = f.create();
  for (const id of f.pending) assert.equal(restored.describe(id).draft, id);
  const revoke = await restored.prepare({ action: "revoke", code: published.code });
  await restored.preview(revoke.draft);
  await restored.commit(revoke.draft);
  assert.equal((await restored.list()).count, 0);
  for (const id of f.pending) assert.equal(restored.describe(id).draft, id);
});
