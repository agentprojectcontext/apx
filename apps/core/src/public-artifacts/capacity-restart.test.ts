import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";
import { publicationTransport } from "./test-cloud.ts";

test("twenty persisted receipts leave room to revoke after a real core restart", async () => {
  const cloud = publicationTransport();
  const options = {
    llm: scriptedLlm(() => say("Done")),
    accountClient: JSON.stringify({ project: "demo-apx-artifacts", apiKey: "public-test-key" }),
    publicArtifactFetch: cloud.fetch,
  };
  const first = await startCore(options);
  let closed = false;
  let second: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    first.core.secrets.set(
      APX_ACCOUNT_SESSION,
      JSON.stringify({
        uid: "person",
        idToken: "private-identity-token",
        refreshToken: "private-refresh-token",
        expires: Number.MAX_SAFE_INTEGER,
        profile: { id: "abcd1234", name: "Acme", photo: "", handle: "" },
      }),
    );
    let code = "";
    for (let i = 0; i < 20; i++) {
      const source = await first.client.call("surfaces.show", {
        name: `orders-${i}`,
        title: "Orders",
        html: "<h1>Orders</h1>",
      });
      const draft = await first.client.call("surfaces.public_prepare", { action: "publish", surface: source.id });
      code = draft.code;
      await first.client.call("surfaces.public_commit", { draft: draft.draft });
    }
    assert.equal((await first.client.call("surfaces.public_list", {})).count, 20);
    const stored = JSON.parse(first.core.store.settings.get("public_artifact_drafts") ?? "[]");
    assert.equal(stored.length, 20);
    assert.ok(stored.every((draft: { copy?: unknown }) => !draft.copy));
    await first.core.close();
    closed = true;
    second = await startCore({ ...options, home: first.home });
    const revoke = await second.client.call("surfaces.public_prepare", { action: "revoke", code });
    await second.client.call("surfaces.public_preview", { draft: revoke.draft });
    await second.client.call("surfaces.public_commit", { draft: revoke.draft });
    assert.equal((await second.client.call("surfaces.public_list", {})).count, 19);
    const receipts = JSON.parse(second.core.store.settings.get("public_artifact_drafts") ?? "[]");
    assert.equal(receipts.length, 20);
    assert.ok(receipts.every((draft: { done?: unknown; copy?: unknown }) => draft.done && !draft.copy));
    assert.equal(cloud.commits(), 21);
  } finally {
    await second?.core.close();
    if (!closed) await first.core.close();
    await first.cleanup();
  }
});
