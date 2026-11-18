import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicationDrafts, type PublicationSession } from "./drafts.ts";
import { createPublicArtifactCloud } from "./firestore.ts";
import { publicationTransport } from "./test-cloud.ts";

for (const action of ["publish", "update", "revoke"] as const) {
  test(`a confirmed ${action} wins over local receipt and logging failures, while write errors still fail`, async () => {
    const remote = publicationTransport();
    const cloud = createPublicArtifactCloud({ project: "demo-apx-artifacts", fetch: remote.fetch });
    const session: PublicationSession = { uid: "person", idToken: "test-token", generation: 1, current: () => true };
    let fail = false;
    let errors = 0;
    let version = 1;
    const drafts = createPublicationDrafts({
      account: { withSession: (work) => work(session) },
      cloud,
      source: () => ({ name: "orders", title: "Orders", html: "<h1>Orders</h1>", app: false, version, state: {} }),
      decorateHtml: (html) => html,
      persistence: {
        load: () => [],
        save: () => {
          if (fail) throw new Error("Disk unavailable");
        },
      },
      onReceiptPersistenceError: () => {
        errors++;
        throw new Error("Logger unavailable");
      },
    });
    const initial = await drafts.prepare({ action: "publish", surface: "orders" });
    if (action !== "publish") await drafts.commit(initial.draft);
    if (action === "update") version = 2;
    const target =
      action === "publish"
        ? initial
        : await drafts.prepare({ action, code: initial.code, ...(action === "update" ? { surface: "orders" } : {}) });
    fail = true;
    const receipt = await drafts.commit(target.draft);
    assert.equal(receipt.action, action);
    assert.equal(errors, 1);
    assert.deepEqual(await drafts.commit(target.draft), receipt);
    assert.equal(remote.commits(), action === "publish" ? 1 : 2);
    assert.equal((await drafts.list()).count, action === "revoke" ? 0 : 1);

    fail = false;
    const rejected = await drafts.prepare({ action: "publish", surface: "orders" });
    cloud.publish = async () => {
      throw new Error("Cloud unavailable");
    };
    fail = true;
    await assert.rejects(drafts.commit(rejected.draft), /Cloud unavailable/);
    assert.equal(errors, 1);
  });
}
