// The owner asks the super-agent from inside the Flow editor: a chat card opens over the canvas in the step card's
// place, the owner's unsaved edits are saved before the message goes, and the step the agent adds appears on the
// canvas without a reload, marked for a moment. Their Save makes it the owner's. A new flow the agent is asked to make
// becomes the editor's flow. FLOW_SHOTS=<folder> saves the editor with the chat open at desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

/** The super-agent's name as this core has it (another spec may have renamed it). */
const superName = async () =>
  (await rpc<Result<"agents.list">>("agents.list", {})).agents.find((a) => a.kind === "secretary")?.name ?? "";

const shots = process.env.FLOW_SHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  // After the mark's entrance, as it stays for a few seconds.
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

for (const phone of [false, true]) {
  const at = phone ? "phone" : "desktop";
  test(`the super-agent asked from the editor adds a step that appears on the canvas, and Save makes it the owner's (${at})`, async ({
    page,
  }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await rpc("setup.finish", {});
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Acme intake ${at}` })).project
      .id;
    const made = await rpc<Result<"flows.create">>("flows.create", {
      project,
      name: "Lead intake",
      graph: {
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
      },
    });
    const flow = made.flow.id;
    const boss = await superName();
    await open(page, `#view=flows&scope=${project}&flow=${flow}&edit=1`);
    const editor = page.locator(".fe");
    // The editor's own canvas, not the Flow's picture in the chat's answer.
    const canvas = editor.locator(".fe-canvas > .fc");
    await expect(canvas.locator(".react-flow__node")).toHaveCount(2);

    // An edit the owner hasn't saved: it goes with the next message, so the agent starts from it.
    await canvas.locator('.react-flow__node[data-id="hook"]').click();
    await editor.getByRole("textbox", { name: "Nombre del paso" }).fill("A lead arrives");
    // The top bar's status is left out on a phone.
    if (!phone) await expect(editor.getByRole("status").filter({ hasText: "Sin guardar" })).toBeVisible();

    // The chat takes the step card's place.
    await editor.getByRole("button", { name: `Pedírselo a ${boss}` }).click();
    const chat = editor.getByRole("complementary", { name: `Chat con ${boss} sobre este flow` });
    await expect(chat).toBeVisible();
    await expect(editor.getByRole("complementary", { name: "Ajustes del paso" })).toBeHidden();
    await expect(chat).toContainText(`Contale a ${boss} qué tiene que hacer este flow`);
    await chat.getByRole("textbox", { name: /Escribile/ }).fill("add a cleanup step");
    await page.keyboard.press("Enter");

    // The owner's bubble is only their words (the core tells the agent which Flow); the step appears on the
    // canvas, marked, with no reload.
    await expect(chat.getByText("add a cleanup step", { exact: true })).toBeVisible();
    await expect(chat).not.toContainText("flow editor");
    await expect(chat).not.toContainText(flow);
    const added = canvas.locator('.react-flow__node[data-id="tidy"]');
    await expect(added).toBeVisible();
    await expect(added.locator(".fc-mark")).toBeVisible();
    await expect(added).toContainText("Tidy the lead");
    await expect(canvas.locator('.react-flow__node[data-id="hook"]')).toContainText("A lead arrives");
    await expect(chat).toContainText("Got it");
    // The answer's card for this Flow is one line here: the canvas is its picture.
    await expect(chat.getByText("Dibujo actualizado")).toBeVisible();
    await expect(chat.getByRole("button", { name: "Abrir en el editor" })).toHaveCount(0);
    if (!phone)
      await expect(
        editor.getByRole("status").filter({ hasText: `Lo dibujó ${boss}: revisalo y guardalo` }),
      ).toBeVisible();
    await expect(editor.locator(".fe-agent")).toBeHidden();
    const drawn = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
    expect(drawn.draftBy).toBe("superagent");
    expect(drawn.draft?.nodes.find((n) => n.id === "hook")?.label).toBe("A lead arrives");
    await shot(page, `flow-ask-${at}`);

    // Reopening continues the same chat.
    await chat.getByRole("button", { name: "Cerrar" }).click();
    await expect(chat).toBeHidden();
    await editor.getByRole("button", { name: `Pedírselo a ${boss}` }).click();
    await expect(chat).toContainText("Got it");

    await editor.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect
      .poll(async () => (await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow })).draftBy)
      .toBeNull();
    const saved = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
    expect(saved.draft?.nodes.map((n) => n.id)).toContain("tidy");
  });
}

test("a new flow the super-agent is asked to make becomes the editor's flow", async ({ page }) => {
  await rpc("setup.finish", {});
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Acme new" })).project.id;
  const boss = await superName();
  await open(page, `#view=flows&scope=${project}`);
  await page.getByRole("button", { name: "Nuevo flow" }).first().click();
  const editor = page.locator(".fe");
  const canvas = editor.locator(".fe-canvas > .fc");
  await editor.getByRole("button", { name: `Pedírselo a ${boss}` }).click();
  const chat = editor.getByRole("complementary", { name: `Chat con ${boss} sobre este flow` });
  await chat.getByRole("textbox", { name: /Escribile/ }).fill("make this flow");
  await page.keyboard.press("Enter");

  await expect(chat).not.toContainText(project);
  await expect(canvas.locator(".react-flow__node")).toHaveCount(2);
  await expect(editor.getByRole("textbox", { name: "Nombre del flow" })).toHaveValue("Lead intake");
  const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.id ?? "";
  await expect(page).toHaveURL(new RegExp(`flow=${flow}.*edit=1`));

  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  // Saved, and the owner's now (it can't run until its table exists in the project: D-176).
  await expect(editor.getByText(/^Guardado/)).toBeVisible();
  await expect.poll(async () => (await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow })).draftBy).toBeNull();
  expect((await rpc<Result<"flows.list">>("flows.list", { project })).flows).toHaveLength(1);
});
