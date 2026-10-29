// A connection drawn in the Flow editor can be taken away: clicking it marks it and shows a bin, and Delete does the
// same. A connection that would close a loop is never made.
import type { Locator, Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

/** Clicks a connection where it is drawn, halfway along. */
async function pick(page: Page, link: Locator) {
  const box = await link.locator(".react-flow__edge-path").boundingBox();
  if (!box) throw new Error("connection not drawn");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("a connection is picked and removed from the canvas, and a loop is never drawn", async ({ page }) => {
  await rpc("setup.finish", {});
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Acme links" })).project.id;
  await page.addInitScript(() => localStorage.setItem("apx.prefs", JSON.stringify({ language: "es" })));
  await open(page, `#view=flows&scope=${project}`);
  await page.getByRole("button", { name: "Nuevo flow" }).first().click();
  const editor = page.locator(".fe");
  await editor.getByRole("button", { name: "Sumar Webhook entrante" }).click();
  await editor.getByRole("button", { name: "Sumar Variables" }).click();
  await editor.getByRole("button", { name: "Sumar JavaScript" }).click();
  await editor.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  // The steps just added moved the first ones out of view: show them all.
  await editor.getByRole("button", { name: "Encuadrar" }).click();
  const edges = editor.locator(".react-flow__edge");
  await expect(edges).toHaveCount(2);

  // Joining the last step back to the second one would close a loop: nothing is added.
  await editor
    .locator('.react-flow__node[data-id="js-1"] .react-flow__handle.source')
    .dragTo(editor.locator('.react-flow__node[data-id="vars-1"] .react-flow__handle.target'));
  await expect(edges).toHaveCount(2);

  // A click marks the connection and shows its bin; the bin takes it away.
  const link = editor.locator('.react-flow__edge[data-id="vars-1:js-1"]');
  await pick(page, link);
  await expect(link).toHaveClass(/is-picked/);
  await editor.getByRole("button", { name: "Quitar conexión" }).click();
  await expect(edges).toHaveCount(1);
  await expect(link).toHaveCount(0);

  // Delete removes a picked one too.
  const first = editor.locator('.react-flow__edge[data-id="webhook-1:vars-1"]');
  await pick(page, first);
  await expect(first).toHaveClass(/is-picked/);
  await page.keyboard.press("Delete");
  await expect(edges).toHaveCount(0);
});
