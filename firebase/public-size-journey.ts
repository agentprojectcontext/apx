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
    const step = await openPublicStep(page, language);
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    await withData(page, language).click();
    await expect(page.getByRole("alert")).toContainText(message);
    assert.equal(await step.evaluate((element) => element.scrollWidth > element.clientWidth), false);
    assert.equal(deps.commits(), writes);
    assert.deepEqual(original(deps.source), before);
    if (process.env.PUBLIC_COPY_EVIDENCE)
      await page.screenshot({
        path: path.join(process.env.PUBLIC_COPY_EVIDENCE, `panel-size-${deps.width}-${language}.png`),
      });
    await withData(page, language).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(step.getByRole("button", { name: confirmName(language), exact: true })).toBeEnabled();
    assert.equal(deps.commits(), writes);
    await step.getByRole("button", { name: language === "es" ? "Cancelar" : "Cancel", exact: true }).click();
  } finally {
    core.store.surfaces.get = original;
  }
}

const confirmName = (language: "en" | "es") =>
  new RegExp(language === "es" ? "^(Compartir público|Actualizar)$" : "^(Share public|Update)$");

/** The switch that sends the widget's saved data with the copy. */
export const withData = (page: Page, language: "en" | "es") =>
  page.getByRole("switch", {
    name: language === "es" ? /Incluir los datos que guardó el widget/ : /Include the data this widget saved/,
  });

/**
 * Opens the artifact's Share panel and its public step: choosing Public, or Update with your changes when it already is.
 * Returns the step's dialog.
 */
export async function openPublicStep(page: Page, language: "en" | "es") {
  const es = language === "es";
  await page.getByRole("button", { name: es ? /^Compartid?[or]$/ : /^Share[d]?$/ }).click();
  const update = page.getByRole("button", { name: es ? "Actualizar con tus cambios…" : "Update with your changes…" });
  if (await update.count()) await update.click();
  else {
    await page.getByRole("combobox", { name: es ? "Quién lo puede ver" : "Who can see it" }).click();
    await page.getByRole("option", { name: es ? /^Público/ : /^Public/ }).click();
  }
  const step = page.getByRole("dialog", {
    name: es ? /^(Compartir público|Actualizar el enlace público)$/ : /^(Share public|Update the public link)$/,
  });
  await expect(step).toBeVisible();
  return step;
}
