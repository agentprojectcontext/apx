import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";
import { publicationTransport } from "./test-cloud.ts";

test("the real protocol reports a successful cloud publication even when receipt storage fails", async () => {
  const cloud = publicationTransport();
  const env = await startCore({
    llm: scriptedLlm(() => say("Done")),
    accountClient: JSON.stringify({ project: "demo-apx-artifacts", apiKey: "public-test-key" }),
    publicArtifactFetch: cloud.fetch,
  });
  const settings = env.core.store.settings;
  const set = settings.set;
  try {
    env.core.secrets.set(
      APX_ACCOUNT_SESSION,
      JSON.stringify({
        uid: "person",
        idToken: "test-token",
        refreshToken: "test-refresh",
        expires: Number.MAX_SAFE_INTEGER,
        profile: { id: "abcd1234", name: "Acme", photo: "", handle: "" },
      }),
    );
    const source = await env.client.call("surfaces.show", { name: "orders", title: "Orders", html: "<h1>Orders</h1>" });
    const draft = await env.client.call("surfaces.public_prepare", { action: "publish", surface: source.id });
    settings.set = (key, value) => {
      if (key === "public_artifact_drafts") throw new Error("Receipt database unavailable");
      set(key, value);
    };
    const receipt = await env.client.call("surfaces.public_commit", { draft: draft.draft });
    assert.equal(receipt.action, "publish");
    assert.deepEqual(await env.client.call("surfaces.public_commit", { draft: draft.draft }), receipt);
    assert.equal((await env.client.call("surfaces.public_list", {})).count, 1);
    assert.equal(cloud.commits(), 1);
  } finally {
    settings.set = set;
    await env.core.close();
    await env.cleanup();
  }
});
