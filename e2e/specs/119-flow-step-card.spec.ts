// The chosen step's settings float in a card over the canvas: clicking a step pans it into the part the card leaves
// visible, at the same zoom; the canvas, × and Escape close it. FLOW_SHOTS=<folder> saves the editor with the card
// open and closed, at desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

const L = {
  en: {
    newFlow: "New flow",
    name: "Flow name",
    add: (k: string) => `Add ${k}`,
    hook: "Incoming webhook",
    vars: "Variables",
    check: "Check",
    card: "Step settings",
    close: "Close",
    zoomOut: "Zoom out",
    addStep: "Add a step",
  },
  es: {
    newFlow: "Nuevo flow",
    name: "Nombre del flow",
    add: (k: string) => `Sumar ${k}`,
    hook: "Webhook entrante",
    vars: "Variables",
    check: "Condición",
    card: "Ajustes del paso",
    close: "Cerrar",
    zoomOut: "Alejar",
    addStep: "Sumar un paso",
  },
};

const shots = process.env.FLOW_SHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  const size = page.viewportSize();
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, `${name}-phone.png`) });
  if (size) await page.setViewportSize(size);
  await page.waitForTimeout(400);
}

/** The canvas zoom, read from the transform React Flow draws with. */
const zoomOf = (editor: Locator) =>
  editor
    .locator(".react-flow__viewport")
    .evaluate((el) => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? Number.NaN));

for (const lang of ["en", "es"] as const) {
  test(`a clicked step opens its card and moves into view at the same zoom; the canvas, × and Escape close it (${lang})`, async ({
    page,
  }) => {
    const l = L[lang];
    await rpc("setup.finish");
    const created = await rpc<{ project: { id: string } }>("projects.create", { name: `Card ${lang}` });
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    await open(page, `#view=flows&scope=${created.project.id}`);
    await page.getByRole("button", { name: l.newFlow }).first().click();
    // The step types are hidden on a phone, so the editor is found by its own box.
    const editor = page.locator(".fe");
    await editor.getByRole("textbox", { name: l.name }).fill(`Card ${lang}`);
    await editor.getByRole("button", { name: l.add(l.hook) }).click();
    await editor.getByRole("button", { name: l.add(l.vars) }).click();
    await editor.getByRole("button", { name: l.add(l.check) }).click();

    // A new step opens its card and moves to the middle of what the card leaves visible, like a clicked one.
    const card = editor.getByRole("complementary", { name: l.card });
    await expect(card).toBeVisible();
    await expect(card.locator(".drawer__title")).toHaveText(l.check);
    const canvas = editor.locator(".fe-canvas");
    const offCentre = (step: Locator) => async () => {
      const [c, k, n] = await Promise.all([canvas.boundingBox(), card.boundingBox(), step.boundingBox()]);
      if (!c || !k || !n) return Number.POSITIVE_INFINITY;
      return Math.abs(n.x + n.width / 2 - (c.x + (k.x - c.x) / 2));
    };
    await expect.poll(offCentre(editor.locator('.react-flow__node[data-id="condition-1"]'))).toBeLessThan(4);
    await shot(page, `flow-card-open-${lang}`);

    // The canvas closes it.
    await editor.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
    await expect(card).toBeHidden();
    await shot(page, `flow-card-closed-${lang}`);

    // The first step, out of view by now, is chosen from the list of steps and moves into view.
    const hook = editor.locator('.react-flow__node[data-id="webhook-1"]');
    await editor.locator(".fe-order__row", { hasText: l.hook }).click();
    await expect.poll(offCentre(hook)).toBeLessThan(4);
    await card.getByRole("button", { name: l.close }).click();
    await expect(card).toBeHidden();

    // A step clicked at another zoom keeps that zoom and lands in the middle of what the card leaves visible.
    await editor.getByRole("button", { name: l.zoomOut }).click();
    await expect.poll(() => zoomOf(editor)).toBeLessThan(1);
    const zoom = await zoomOf(editor);
    await hook.click();
    await expect(card).toBeVisible();
    await expect(card.locator(".drawer__title")).toHaveText(l.hook);
    await expect.poll(offCentre(hook)).toBeLessThan(4);
    expect(await zoomOf(editor)).toBeCloseTo(zoom, 5);

    // × and Escape close it.
    await card.getByRole("button", { name: l.close }).click();
    await expect(card).toBeHidden();
    await hook.click();
    await expect(card).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    expect(await zoomOf(editor)).toBeCloseTo(zoom, 5);

    // On a phone the step types wait behind a button, and nothing runs past the edge.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(editor.getByRole("button", { name: l.add(l.hook) })).toBeHidden();
    await editor.getByRole("button", { name: l.addStep }).click();
    await expect(editor.getByRole("button", { name: l.add(l.vars) })).toBeVisible();
    await editor.getByRole("button", { name: l.add(l.vars) }).click();
    await expect(editor.getByRole("button", { name: l.add(l.vars) })).toBeHidden();
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (shots) await page.screenshot({ path: path.join(shots, `flow-card-sheet-${lang}.png`) });
  });
}
