import assert from "node:assert/strict";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import type { createCore } from "../apps/core/src/server.ts";

export async function checkOversizedPublication(deps: {
  core: Awaited<ReturnType<typeof createCore>>;
  page: Page;
  source: string;
  width: number;
  language: "en" | "es";
  commits(): number;
}) {
  const { core, page, language } = deps;
  const original = core.store.surfaces.get;
  const before = original(deps.source);
  assert.ok(before);
  const writes = deps.commits();
  // A synthetic older source exercises the publication boundary without changing local-state limits.
  const state = { ...before.state, Video: `data:video/mp4;base64,${"a".repeat(10_000_000)}` };
  core.store.surfaces.get = (id) => {
    const source = original(id);
    return source?.id === deps.source ? { ...source, state } : source;
  };
  const message =
    language === "es"
      ? "Es demasiado grande para publicarlo (máximo 10 MB). Sigue en tu APX."
      : "It's too large to publish (maximum 10 MB). It's still in your APX.";
  try {
    await page.goto(`${core.url}/#app=${deps.source}`);
    await page.reload();
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: language === "es" ? "Compartir" : "Share", exact: true }).click();
    await page
      .getByRole("menuitem", { name: language === "es" ? "Publicar copia…" : "Publish copy…", exact: true })
      .click();
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Video", exact: true }).check();
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: language === "es" ? "Revisar copia" : "Review copy", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(message);
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
    assert.equal(deps.commits(), writes);
    assert.deepEqual(original(deps.source), before);
    if (process.env.PUBLIC_COPY_EVIDENCE)
      await page.screenshot({
        path: path.join(process.env.PUBLIC_COPY_EVIDENCE, `panel-size-${deps.width}-${language}.png`),
      });
    await page.getByRole("checkbox", { name: "Video", exact: true }).uncheck();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: language === "es" ? "Revisar copia" : "Review copy", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: language === "es" ? "Revisá esta copia exacta" : "Review this exact copy" }),
    ).toBeVisible();
    assert.equal(deps.commits(), writes);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: language === "es" ? "Cancelar" : "Cancel", exact: true })
      .click();
  } finally {
    core.store.surfaces.get = original;
  }
}
