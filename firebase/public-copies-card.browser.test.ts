import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { testConfig } from "../apps/core/src/config.ts";
import { callTool, pendingInput, say, scriptedLlm } from "../apps/core/src/engine/testkit.ts";
import { APX_ACCOUNT_SESSION } from "../apps/core/src/secret-names.ts";
import { createCore } from "../apps/core/src/server.ts";
import { tempDir, waitFor } from "../apps/core/src/testkit/platform.ts";
import { ApxClient } from "../packages/protocol/src/client.ts";
import { browserCloud } from "./browser-cloud.ts";

for (const width of [1280, 390]) {
  test(`an agent publication card must open its exact review before approval at ${width}px`, async () => {
    const home = tempDir("apx-public-card-");
    const cloud = browserCloud(`card-${width}`);
    let draft = "";
    const core = await createCore(
      testConfig({
        home: home.path,
        webDist: path.resolve(import.meta.dirname, "../apps/web/dist"),
        accountClient: JSON.stringify({ project: "demo-apx-artifacts", apiKey: "public-test-key" }),
        providers: [{ id: "fake", transport: "openai-chat", base_url: "http://fake.test", key: "none", models: [] }],
      }),
      {
        quiet: true,
        publicArtifactFetch: cloud.fetch,
        llm: scriptedLlm((_req, { afterTool }) =>
          afterTool
            ? say("Done")
            : callTool("publish", "apx_settings", { method: "surfaces.public_commit", params: { draft } }),
        ),
      },
    );
    const browser = await chromium.launch({ headless: true });
    try {
      core.store.settings.set("model_default", JSON.stringify({ model: "fake/fake-1", router: false }));
      core.store.settings.set("model_aux", "off");
      core.secrets.set(
        APX_ACCOUNT_SESSION,
        JSON.stringify({
          uid: cloud.uid,
          idToken: cloud.token,
          refreshToken: "private-refresh-token",
          expires: Number.MAX_SAFE_INTEGER,
          profile: { id: "abcd1234", name: "Acme", photo: "", handle: "" },
        }),
      );
      const client = new ApxClient({ url: core.url });
      await client.call("setup.finish", {});
      const source = await client.call("surfaces.show", {
        name: "orders",
        title: "Orders",
        html: "<h1>Reviewed orders</h1>",
      });
      draft = (await client.call("surfaces.public_prepare", { action: "publish", surface: source.id })).draft;
      await client.call("agents.update", { agent: "superagent", autonomy: "total" });
      const thread = await client.call("threads.create", { kind: "loose", agent_id: "superagent" });
      await client.call("threads.send", { thread: thread.id, text: "Publish the Orders copy." });
      const input = await pendingInput(client, thread.id);
      await assert.rejects(
        client.call("runs.respond", { input: input.id, decision: "approve" }),
        /public_artifact_review_required/,
      );
      const page = await browser.newPage({ locale: "en-US", viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${core.url}/#thread=${thread.id}`);
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      await page.getByRole("button", { name: "Review public copy", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Share public" });
      await expect(dialog).toContainText("Publishing as Acme");
      const frame = page.frameLocator('iframe[title="Published page preview"]').frameLocator("iframe");
      await expect(frame.getByRole("heading", { name: "Reviewed orders" })).toBeVisible();
      assert.equal(cloud.commits(), 0);
      if (process.env.PUBLIC_COPY_EVIDENCE)
        await page.screenshot({ path: path.join(process.env.PUBLIC_COPY_EVIDENCE, `agent-review-${width}-en.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      assert.equal(core.store.inputs.get(input.id)?.state, "pending");
      assert.equal((await client.call("surfaces.public_preview", { draft })).draft, draft);
      await page.getByRole("button", { name: "Review public copy", exact: true }).click();
      await expect(frame.getByRole("heading", { name: "Reviewed orders" })).toBeVisible();
      await dialog.getByRole("button", { name: "Share public", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await waitFor(() => cloud.commits() === 1, "publication after exact review", { ms: 10_000 });
      assert.equal(core.store.inputs.get(input.id)?.state, "approved");
      assert.equal((await client.call("surfaces.public_list", {})).count, 1);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await core.close();
      await home.remove();
    }
  });
}
