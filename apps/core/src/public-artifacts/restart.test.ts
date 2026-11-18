import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, pendingInput, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";
import { publicationTransport } from "./test-cloud.ts";

test("a pending public-copy card survives a core restart but its old review token cannot approve it", async () => {
  let draft = "";
  const cloud = publicationTransport();
  const llm = scriptedLlm((_request, { afterTool }) =>
    afterTool
      ? say("Done")
      : callTool("publish", "apx_settings", {
          method: "surfaces.public_commit",
          params: { draft },
        }),
  );
  const options = {
    llm,
    accountClient: JSON.stringify({ project: "demo-apx-artifacts", apiKey: "public-test-key" }),
    publicArtifactFetch: cloud.fetch,
  };
  const first = await startCore(options);
  let second: Awaited<ReturnType<typeof startCore>> | undefined;
  let firstClosed = false;
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
    const source = await first.client.call("surfaces.show", {
      name: "orders",
      title: "Orders",
      html: "<h1>Orders</h1>",
    });
    draft = (await first.client.call("surfaces.public_prepare", { action: "publish", surface: source.id })).draft;
    const review = await first.client.call("surfaces.public_preview", { draft });
    await first.client.call("agents.update", { agent: "superagent", autonomy: "total" });
    const thread = await first.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await first.client.call("threads.send", { thread: thread.id, text: "Publish Orders." });
    const input = await pendingInput(first.client, thread.id);
    const stored = first.core.store.settings.get("public_artifact_drafts") ?? "";
    assert.ok(stored.includes(draft));
    assert.doesNotMatch(stored, /<h1>|"json":/);
    assert.equal(stored.includes(review.review_token), false);
    assert.doesNotMatch(stored, /private-identity-token|private-refresh-token|reviewToken|generation/);
    await first.core.close();
    firstClosed = true;
    second = await startCore({ ...options, home: first.home });
    assert.equal(second.core.store.inputs.get(input.id)?.state, "pending");
    await assert.rejects(
      second.client.call("runs.respond", {
        input: input.id,
        decision: "approve",
        artifact_review: review.review_token,
      }),
      /public_artifact_review_required/,
    );
    const fresh = await second.client.call("surfaces.public_preview", { draft });
    assert.deepEqual(fresh.bundle, review.bundle);
    assert.notEqual(fresh.review_token, review.review_token);
    assert.equal(cloud.commits(), 0);
    await second.client.call("runs.respond", {
      input: input.id,
      decision: "approve",
      artifact_review: fresh.review_token,
    });
    await second.settle(thread.id);
    assert.equal(cloud.commits(), 1);
  } finally {
    await second?.core.close();
    if (!firstClosed) await first.core.close();
    await first.cleanup();
  }
});
