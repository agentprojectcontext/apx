// A Flow's history (DECISIONS.md#d-179): each save in the editor leaves a version; the Flow's page lists them under
// History, draws an older one read-only with its label, and restores it as the draft (asking first) without publishing;
// the editor then shows it, and its own history button restores another into the canvas. FLOW_SHOTS=<folder> saves the
// page with a version open and the editor's history, at desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.FLOW_SHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

type Graph = NonNullable<Result<"flows.graph_get">["published"]>;
const intake: Graph = {
  schemaVersion: 2,
  nodes: [
    { id: "hook", kind: "webhook", label: "New lead" },
    {
      id: "save",
      kind: "table_write",
      label: "Save the lead",
      table: "leads",
      key: "latest",
      value: { kind: "event", path: [] },
    },
  ],
  edges: [{ source: "hook", target: "save" }],
  layout: [
    { node: "hook", x: 0, y: 0 },
    { node: "save", x: 280, y: 0 },
  ],
};
const docOf = (flow: string) => rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });

for (const phone of [false, true]) {
  const at = phone ? "phone" : "desktop";
  test(`saves leave versions; an older one is drawn, restored as the draft and shown in the editor (${at})`, async ({
    page,
  }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await rpc("setup.finish", {});
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Acme history ${at}` })).project
      .id;
    await rpc("tables.create", { project, name: "leads" });
    const flow = (await rpc<Result<"flows.create">>("flows.create", { project, name: "Lead intake", graph: intake }))
      .flow.id;

    // Two saves in the editor, each with one more step.
    await open(page, `#view=flows&scope=${project}&flow=${flow}&edit=1`);
    const editor = page.locator(".fe");
    const nodes = editor.locator(".fe-canvas > .fc .react-flow__node");
    await expect(nodes).toHaveCount(2);
    for (const count of [3, 4]) {
      if (phone) await editor.getByRole("button", { name: "Sumar un paso" }).click();
      await editor.getByRole("button", { name: "Sumar JavaScript" }).click();
      await expect(nodes).toHaveCount(count);
      await editor.getByRole("button", { name: "Guardar borrador" }).click();
      await expect(editor.getByRole("status").filter({ hasText: "Borrador guardado." })).toBeVisible();
    }
    await editor.getByRole("button", { name: "Salir del editor" }).click();

    // The Flow's page: History lists the two saves and the drawing it was made with.
    await open(page, `#view=flows&scope=${project}&flow=${flow}`);
    await page.getByRole("radio", { name: "Historial" }).click();
    const versions = page.locator(".fd__ver");
    await expect(versions).toHaveCount(3);
    await expect(versions.nth(0)).toContainText("#3");
    await expect(versions.nth(0)).toContainText("Borrador guardado");
    await expect(versions.nth(0)).toContainText("4 pasos");
    await expect(versions.nth(1)).toContainText("3 pasos");

    // The oldest is drawn read-only, labelled.
    await versions.nth(2).click();
    const canvas = page.locator(".fd__canvas");
    await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
    await expect(canvas.locator(".fd__version")).toContainText(/^Versión #1 · .+ · Vos$/);
    await expect(page.getByText("Una versión anterior. No corre")).toBeVisible();
    await shot(page, `page-version-${at}`);
    if (phone) {
      await page.locator(".fd__rail").scrollIntoViewIfNeeded();
      // Under the page the list fills the width it has, never past the screen's edge.
      const rail = await page.locator(".fd__rail").boundingBox();
      expect((rail?.x ?? 0) + (rail?.width ?? 0)).toBeLessThanOrEqual(390);
      await shot(page, `page-history-list-${at}`);
    }

    // Restoring asks first, makes it the draft and publishes nothing.
    await page.getByRole("button", { name: "Restaurar como borrador" }).click();
    const ask = page.getByRole("dialog", { name: "¿Restaurar la versión #1 como borrador?" });
    await expect(ask).toContainText("Lo que corre no cambia");
    await ask.getByRole("button", { name: "Restaurar como borrador" }).click();
    await expect(page.getByText("La versión #1 es el borrador ahora.")).toBeVisible();
    const doc = await docOf(flow);
    expect(doc.draft?.nodes.map((n) => n.id)).toEqual(["hook", "save"]);
    expect(doc.publishedRevision).toBeNull();
    await expect(versions).toHaveCount(4);
    await expect(versions.nth(0)).toContainText("Restaurada desde la #1");

    // The editor shows it; its history brings back the four steps into the canvas.
    await page.getByRole("button", { name: "Editar flujo" }).click();
    await expect(nodes).toHaveCount(2);
    await editor.getByRole("button", { name: "Historial" }).click();
    const list = page.locator(".fe-hist");
    await expect(list.locator(".fd__ver")).toHaveCount(4);
    await shot(page, `editor-history-${at}`);
    await list.locator(".fd__ver").filter({ hasText: "#3" }).click();
    const again = page.getByRole("dialog", { name: "¿Restaurar la versión #3 como borrador?" });
    await again.getByRole("button", { name: "Restaurar como borrador" }).click();
    await expect(nodes).toHaveCount(4);
    expect((await docOf(flow)).draft?.nodes).toHaveLength(4);
    expect((await docOf(flow)).publishedRevision).toBeNull();
  });
}
