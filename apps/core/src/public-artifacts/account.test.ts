import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createAccount } from "../account/session.ts";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createPublicArtifactCloud } from "./cloud.ts";
import { createPublicationDrafts } from "./drafts.ts";

test("publication drafts use the real account boundary without exposing its credentials", async () => {
  const dir = tempDir("apx-public-account-");
  try {
    const secrets = createSecrets(dir.path, "file", {});
    secrets.set(
      APX_ACCOUNT_SESSION,
      JSON.stringify({
        uid: "person",
        idToken: "private-identity-token",
        refreshToken: "private-refresh-token",
        expires: 3600_000,
        profile: { id: "abcd1234", name: "Acme", photo: "", handle: "" },
      }),
    );
    const account = createAccount({
      secrets,
      client: { project: "demo-apx-artifacts", apiKey: "public-test-key" },
      origin: () => "http://127.0.0.1:7449",
      now: () => 1000,
    });
    let writes = 0;
    let availabilityReads = 0;
    const cloud = createPublicArtifactCloud({
      fetch: async (input, init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-identity-token");
        if (new URL(String(input)).pathname.endsWith("/available")) {
          assert.equal(init?.method, "GET");
          availabilityReads++;
          return Response.json({ available: true });
        }
        if (init?.method === "POST") writes++;
        return Response.json(
          init?.method === "POST"
            ? {
                code: new URL(String(input)).pathname.split("/").at(-2),
                sha256: createHash("sha256").update(String(init?.body)).digest("hex"),
              }
            : { documents: [] },
        );
      },
    });
    const service = createPublicationDrafts({
      account,
      cloud,
      source: () => ({
        name: "orders",
        title: "Orders",
        html: "<h1>Orders</h1>",
        version: 1,
        app: true,
        state: { visible: "chosen", private: "not included" },
      }),
      decorateHtml: (html) => html,
      now: () => 1000,
    });
    const draft = await service.prepare({ action: "publish", surface: "orders", state_keys: ["visible"] });
    assert.equal(availabilityReads, 1);
    const preview = await service.preview(draft.draft);
    assert.deepEqual(preview.bundle?.state, { visible: "chosen" });
    assert.equal(writes, 0);
    const receipt = await service.commit(draft.draft);
    assert.equal(writes, 1);
    assert.match(receipt.url, /^https:\/\/artifact\.apxagent\.app\/[0-9abcdefghjkmnpqrstvwxyz]{8}$/);
    assert.doesNotMatch(JSON.stringify({ draft, preview, receipt }), /identity-token|refresh-token|person/);
    account.logout();
    await assert.rejects(service.commit(draft.draft), /sign_in_required/);
    await assert.rejects(service.list(), /sign_in_required/);
    assert.equal(writes, 1);
  } finally {
    await dir.remove();
  }
});
