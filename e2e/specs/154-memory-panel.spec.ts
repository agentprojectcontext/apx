// A project's Memory tab: short rows at the window's width, a note's panel beside the list with what can be done
// with it, and a chat beside the list that reviews the notes with the super-agent.

import type { Locator, Page } from "@playwright/test";
import type { Memory, Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const LONG =
  "Northwind ships its invoices on the first Monday of each month. The finance team checks them the day before, " +
  "and anything sent late goes out with the next batch. Ask before changing the date, because the bank reads it too.";

/** The panel opens in the tab's own body: under the project's header and tab chips, beside the list. */
async function besideTheList(page: Page, panel: Locator) {
  const tab = await page.getByRole("tab", { name: "Memoria" }).boundingBox();
  const box = await panel.boundingBox();
  expect(box?.y ?? 0).toBeGreaterThan((tab?.y ?? 0) + (tab?.height ?? 0));
  const list = await page.locator(".memory__main").boundingBox();
  expect((list?.x ?? 0) + (list?.width ?? 0)).toBeLessThanOrEqual(box?.x ?? 0);
}

test("a project's notes show as short rows; a note opens beside the list with all it can do", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Memory panel" });
  const first = "Northwind uses the blue labels for archived contracts.";
  const note = await rpc<Memory>("memory.add", { scope: "project", project: project.id, text: first });
  await rpc("memory.add", {
    id: note.id,
    scope: "project",
    text: "Northwind uses green labels for archived contracts.",
  });
  await rpc("memory.add", { scope: "project", project: project.id, text: LONG });

  await page.setViewportSize({ width: 1800, height: 800 });
  await open(page, `#project=${project.id}&tab=memory`);
  const list = page.getByRole("list", { name: "Memoria" });
  const long = list.locator(".memrow").filter({ hasText: "ships its invoices" });
  // At most two lines, and the list takes the width the page gives it, not a narrow column.
  const box = await long.locator(".memory__text").boundingBox();
  const line = await long.locator(".memory__text").evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight));
  expect(box?.height ?? 0).toBeLessThanOrEqual(line * 2 + 1);
  expect((await list.boundingBox())?.width ?? 0).toBeGreaterThan(1300);
  await expect(long.getByText("Escrita por vos")).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.screenshot({ path: test.info().outputPath("memory-list-desktop.png") });

  await long.getByRole("button").click();
  const panel = page.getByRole("complementary", { name: "Nota de memoria" });
  await expect(panel.getByText(LONG, { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Revisar con / })).toBeVisible();
  await besideTheList(page, panel);
  await page.screenshot({ path: test.info().outputPath("memory-note-desktop.png") });

  // Its revisions are in the panel, and one is restored from there.
  await list.locator(".memrow").filter({ hasText: "green labels" }).getByRole("button").click();
  const previous = panel.locator(".memory__history li").filter({ hasText: "Revisión 1" });
  await expect(previous.getByText(first, { exact: true })).toBeVisible();
  await previous.getByRole("button", { name: "Restaurar esta revisión" }).click();
  await expect(panel.locator(".memnote__text")).toHaveText(first);

  // Edited in place, then forgotten: the panel closes with the note gone from the list.
  await panel.getByRole("button", { name: "Editar nota" }).click();
  await panel.getByRole("textbox", { name: "Nota" }).fill("Northwind uses violet labels for archived contracts.");
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(list.getByText("violet labels", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Quitar nota" }).click();
  await expect(panel).toBeHidden();
  await expect(list.getByText("violet labels", { exact: false })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await long.getByRole("button").click();
  await expect(panel.getByText(LONG, { exact: true })).toBeVisible();
  // A phone shows the note in the tab's place, under its chips; × goes back to the list.
  const top = (await panel.boundingBox())?.y ?? 0;
  const chip = await page.getByRole("tab", { name: "Memoria" }).boundingBox();
  expect(top).toBeGreaterThan((chip?.y ?? 0) + (chip?.height ?? 0));
  await expect(list).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("memory-note-phone.png") });
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await expect(list).toBeVisible();
});

test("the review chat opens beside the list with the super-agent, ready to go through the notes", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Memory review" });
  await rpc("memory.add", { scope: "project", project: project.id, text: LONG });
  const { agents } = await rpc<Result<"agents.list">>("agents.list", {});
  const boss = agents.find((a) => a.kind === "secretary");
  if (!boss) throw new Error("no super-agent");

  await page.setViewportSize({ width: 1400, height: 800 });
  await open(page, `#project=${project.id}&tab=memory`);
  // Closed before anything was sent, the chat is not kept.
  await page.getByRole("button", { name: `Revisar con ${boss.name}` }).click();
  const chat = page.getByRole("complementary", { name: `Revisando con ${boss.name}` });
  const field = chat.getByRole("textbox");
  await expect(field).toHaveValue(/notas de memoria de este proyecto/);
  await chat.getByRole("button", { name: "Cerrar" }).click();
  await expect(chat).toBeHidden();
  await expect
    .poll(async () => (await rpc<Result<"threads.list">>("threads.list", { project_id: project.id })).threads.length)
    .toBe(0);

  // From a note: its words and id are in the first message, and the chat steps back to the note.
  await page.locator(".memrow").filter({ hasText: "ships its invoices" }).getByRole("button").click();
  await page
    .getByRole("complementary", { name: "Nota de memoria" })
    .getByRole("button", { name: `Revisar con ${boss.name}` })
    .click();
  await expect(field).toHaveValue(/^Revisemos esta nota de memoria \(mem_/);
  await expect(chat.getByText("lee las notas y te propone", { exact: false })).toBeVisible();
  await field.press("Enter");
  await expect(chat.getByText("Got it: Revisemos esta nota", { exact: false })).toBeVisible();
  const { threads } = await rpc<Result<"threads.list">>("threads.list", { project_id: project.id });
  expect(threads).toHaveLength(1);
  expect(threads[0]?.agent_ids).toEqual([boss.id]);
  await besideTheList(page, chat);
  await page.screenshot({ path: test.info().outputPath("memory-review-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("memory-review-phone.png") });
  await chat.getByRole("button", { name: "Volver a la nota" }).click();
  await expect(page.getByRole("complementary", { name: "Nota de memoria" })).toBeVisible();
});
