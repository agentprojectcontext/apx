import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicationDrafts, type PublicationAccount, type PublicationDraftSnapshot } from "./drafts.ts";
import { createPublicArtifactCloud } from "./firestore.ts";
import { publicationTransport } from "./test-cloud.ts";

test("a draft is retained through its actual pending-card deadline, including after restart and pruning", async () => {
  const day = 24 * 60 * 60_000;
  let now = 0;
  let liveDraft = "";
  let deadline = 0;
  let saved: readonly PublicationDraftSnapshot[] = [];
  const account: PublicationAccount = {
    withSession: (work) => work({ uid: "person", idToken: "test-token", generation: 1, current: () => true }),
  };
  const create = () =>
    createPublicationDrafts({
      account,
      cloud: createPublicArtifactCloud({ project: "demo-apx-artifacts", fetch: publicationTransport().fetch }),
      source: () => ({ name: "orders", title: "Orders", html: "<h1>Orders</h1>", version: 1, app: false, state: {} }),
      decorateHtml: (html) => html,
      now: () => now,
      pendingUntil: (id) => (id === liveDraft ? deadline : undefined),
      persistence: {
        load: () => saved,
        save: (drafts) => {
          saved = structuredClone(drafts);
        },
      },
    });
  const original = create();
  const prepared = await original.prepare({ action: "publish", surface: "orders" });
  liveDraft = prepared.draft;
  now = 29 * day;
  deadline = now + 30 * day;
  now = 31 * day;
  const restored = create();
  assert.equal(restored.describe(liveDraft).expires_at, new Date(deadline).toISOString());
  await restored.prepare({ action: "publish", surface: "other" });
  assert.equal(restored.describe(liveDraft).draft, liveDraft);
  assert.equal((await restored.preview(liveDraft)).bundle?.html, "<h1>Orders</h1>");
  now = deadline;
  assert.throws(() => restored.describe(liveDraft), /preview_expired/);
});
