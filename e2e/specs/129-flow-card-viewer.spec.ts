// The drawing on a Flow's chat card opens it larger, only to look at: the canvas pans and zooms, a step clicked shows
// its settings in words beside it (a sheet on a phone), nothing can be changed, and Esc, × or a click outside close it.
// FLOW_SHOTS=<folder> saves the viewer at desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.FLOW_SHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/** A chat where the super-agent drew a Flow in a new project: its card, with the steps drawn. */
async function cardIn(page: Page, name: string) {
  await rpc("setup.finish", {});
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name })).project.id;
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: "Flows" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill(`draw a flow in ${project}`);
  await page.keyboard.press("Enter");
  const card = page.locator(".flowcard");
  await expect(card.locator(".react-flow__node")).toHaveCount(2);
  return card;
}

for (const phone of [false, true]) {
  const at = phone ? "phone" : "desktop";
  test(`the drawing on a Flow's card opens larger to look at each step (${at})`, async ({ page }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    const card = await cardIn(page, `Acme viewer ${at}`);
    await card.getByRole("button", { name: "Ver New leads en grande" }).click();

    const viewer = page.getByRole("dialog", { name: "New leads" });
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText(`Acme viewer ${at}`);
    await expect(viewer).toContainText("Borrador");
    const nodes = viewer.locator(".react-flow__node");
    await expect(nodes).toHaveCount(2);
    // The canvas pans and zooms.
    await expect(viewer.getByRole("button", { name: "Acercar" })).toBeVisible();
    if (phone) {
      // The canvas takes the whole screen; the steps' list waits for a step to be chosen.
      const box = await viewer.boundingBox();
      expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
    } else {
      const steps = viewer.getByRole("complementary", { name: "Pasos" });
      await expect(steps).toContainText("Elegí uno para ver sus ajustes.");
      await expect(steps.getByRole("button", { name: /Save the lead/ })).toBeVisible();
    }
    await shot(page, `flow-viewer-${at}`);

    // A step clicked: its kind, name and settings in words, and where it goes on to.
    await nodes.filter({ hasText: "New lead" }).first().click();
    const sheet = viewer.getByRole("complementary", { name: "Ajustes del paso" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "New lead" })).toBeVisible();
    await expect(sheet).toContainText("Webhook entrante");
    await expect(sheet.locator(".fv__fact").filter({ hasText: "Método" })).toContainText("POST");
    await expect(sheet).toContainText("Sigue con");
    await sheet.getByRole("button", { name: /Save the lead/ }).click();
    await expect(sheet.getByRole("heading", { name: "Save the lead" })).toBeVisible();
    await expect(sheet).toContainText("Guardar en la tabla");
    await expect(sheet.locator(".fv__fact").filter({ hasText: "Tabla" })).toContainText("leads");
    await expect(sheet.locator(".fv__fact").filter({ hasText: "Clave" })).toContainText("$trigger.email");
    await expect(sheet.locator(".fv__fact").filter({ hasText: "Qué guardar" })).toContainText("Todo lo que llegó");
    if (phone) {
      // A sheet over the bottom of the canvas.
      const box = await sheet.boundingBox();
      expect(box?.y).toBeGreaterThan(300);
      expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
      // The chosen step is brought into the part of the canvas the sheet leaves.
      const chosen = nodes.filter({ hasText: "Save the lead" });
      await expect
        .poll(async () => {
          const b = await chosen.boundingBox();
          return b ? b.y > 100 && b.y + b.height < (box?.y ?? 0) && b.x >= 0 && b.x + b.width <= 390 : false;
        })
        .toBe(true);
    }
    await shot(page, `flow-viewer-step-${at}`);

    // Nothing to change: no fields, no steps to move or join, no save, test or delete.
    for (const role of ["textbox", "combobox", "switch", "checkbox", "radio"] as const)
      await expect(viewer.getByRole(role)).toHaveCount(0);
    await expect(viewer.locator(".react-flow__node.draggable")).toHaveCount(0);
    // A step dragged stays where it was, and dragging from a step's way out to another joins nothing.
    const hook = nodes.filter({ hasText: "New lead" }).first();
    const where = await hook.getAttribute("style");
    const from = await hook.boundingBox();
    if (from) {
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 60, from.y + from.height / 2 + 40, { steps: 5 });
      await page.mouse.up();
    }
    await expect(hook).toHaveAttribute("style", where ?? "");
    const out = viewer.locator(".react-flow__node").filter({ hasText: "Save the lead" }).locator(".fc-handle--out");
    const to = await hook.boundingBox();
    const start = await out.boundingBox();
    if (start && to) {
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 5 });
      await page.mouse.up();
    }
    await expect(viewer.locator(".react-flow__edge")).toHaveCount(1);
    await expect(viewer.getByRole("button", { name: /Guardar|Probar|Borrar|Eliminar|Sumar/ })).toHaveCount(0);

    // Back to every step, then closed with Esc.
    await sheet.getByRole("button", { name: "Todos los pasos" }).click();
    await expect(viewer.getByRole("complementary", { name: "Ajustes del paso" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();

    // With the close button.
    await card.getByRole("button", { name: "Ver New leads en grande" }).click();
    await expect(viewer).toBeVisible();
    await viewer.getByRole("button", { name: "Cerrar" }).click();
    await expect(viewer).toBeHidden();

    // Open in the editor from the viewer takes the Flow there.
    await card.getByRole("button", { name: "Ver New leads en grande" }).click();
    await viewer.getByRole("button", { name: "Abrir en el editor" }).click();
    await expect(viewer).toBeHidden();
    await expect(page).toHaveURL(/view=flows.*edit=1/);
  });
}

test("a click outside the viewer closes it", async ({ page }) => {
  const card = await cardIn(page, "Acme outside");
  await card.getByRole("button", { name: "Ver New leads en grande" }).click();
  const viewer = page.getByRole("dialog", { name: "New leads" });
  await expect(viewer).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(viewer).toBeHidden();
  // The card is as it was.
  await expect(card.locator(".react-flow__node")).toHaveCount(2);
});
