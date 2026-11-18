import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { _electron, type ElectronApplication, expect } from "@playwright/test";
import { testConfig } from "../apps/core/src/config.ts";
import { publicArtifactCopy } from "../apps/core/src/domain/public-artifact-copy.ts";
import { publicationTransport } from "../apps/core/src/public-artifacts/test-cloud.ts";
import { artifactWrites } from "../apps/core/src/public-artifacts/writes.ts";
import { createCore } from "../apps/core/src/server.ts";
import { tempDir, waitFor } from "../apps/core/src/testkit/platform.ts";
import { ApxClient } from "../packages/protocol/src/client.ts";

test("a native public link opens the existing install dialog without an account or automatic installation", async () => {
  const home = tempDir("apx-public-native-");
  const cloud = publicationTransport();
  const code = "0123abcd";
  const copy = publicArtifactCopy(
    {
      name: "weekend",
      title: "Weekend plan",
      html: "<h1>Weekend plan</h1>",
      version: 1,
      app: true,
      state: { destination: "Mountains" },
    },
    ["destination"],
  );
  const root = "projects/demo-apx-artifacts/databases/(default)/documents";
  await cloud.fetch(`https://firestore.googleapis.com/v1/${root}:commit`, {
    body: JSON.stringify({ writes: artifactWrites(root, code, copy) }),
  });
  const core = await createCore(
    testConfig({
      home: path.join(home.path, "core"),
      webDist: path.resolve(import.meta.dirname, "../apps/web/dist"),
      accountClient: JSON.stringify({ project: "demo-apx-artifacts", apiKey: "public-test-key" }),
    }),
    { quiet: true, publicArtifactFetch: cloud.fetch },
  );
  let app: ElectronApplication | undefined;
  try {
    const client = new ApxClient({ url: core.url });
    await client.call("setup.finish", {});
    app = await _electron.launch({
      args: [path.resolve(import.meta.dirname, "../apps/desktop/dist/main.js")],
      env: {
        ...process.env,
        APX_URL: core.url,
        APX_HOME: path.join(home.path, "core"),
        APX_PORT: new URL(core.url).port,
        APX_SECRETS: "file",
        APX_DESKTOP_DATA: path.join(home.path, "desktop"),
        APX_QUIT_CONFIRM: "off",
        APX_WEB_URL: "http://127.0.0.1:9",
      },
    });
    const page = await waitFor(() => app?.windows().find((page) => page.url().startsWith(core.url)), "native panel", {
      ms: 30_000,
    });
    await page.evaluate(() => localStorage.setItem("apx.prefs", JSON.stringify({ language: "en" })));
    await page.reload();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await app.evaluate(
      ({ app }, value) => app.emit("open-url", { preventDefault() {} }, value),
      `apx://artifact/${code}`,
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Weekend plan", { exact: true })).toBeVisible();
    assert.equal(core.store.surfaces.list().length, 0);
    if (process.env.PUBLIC_COPY_EVIDENCE)
      await page.screenshot({ path: path.join(process.env.PUBLIC_COPY_EVIDENCE, "native-public-install.png") });
    await dialog.getByRole("button", { name: "Install", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(core.store.surfaces.list().length, 1);
    assert.deepEqual(core.store.surfaces.get(core.store.surfaces.list()[0]?.id ?? "")?.state, {
      destination: "Mountains",
    });
    cloud.documents.clear();
    await app.evaluate(
      ({ app }, value) => app.emit("open-url", { preventDefault() {} }, value),
      `apx://artifact/${code}`,
    );
    await expect(page.getByRole("alert")).toContainText("Could not open this public copy");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Install", exact: true })).toBeDisabled();
    assert.equal(core.store.surfaces.list().length, 1);
  } finally {
    await app?.close();
    await core.close();
    await home.remove();
  }
});
