// A document's folder, "open apart" and download: on its page, and on hover in the documents list and its chat card.
import type { Message } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("a document names its file and offers its folder, open apart and download wherever it shows", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "roby" });
  await rpc("threads.send", { thread: chat.id, text: "open a report" });
  await expect
    .poll(async () => {
      const { messages } = await rpc<{ messages: Message[] }>("threads.get", { thread: chat.id });
      return messages.some((m) => m.parts.some((p) => p.type === "file" && p.document));
    })
    .toBe(true);

  await open(page, `#thread=${chat.id}`);
  const transcript = page.locator(".transcript");
  const card = transcript.locator(".documentpart__wrap");
  await expect(card).toContainText("notes/report.md");
  await card.hover();
  for (const name of ["Mostrar en Finder", "Abrir en su app", "Descargar"])
    await expect(card.getByRole("button", { name })).toBeVisible();
  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: "Descargar" }).click();
  expect((await download).suggestedFilename()).toBe("report.md");

  await card.locator(".documentpart").click();
  const panel = page.locator(".documentpanel");
  await expect(panel.getByRole("heading", { name: "Quarter report" })).toBeVisible();
  await expect(panel.locator(".documentpanel__filename")).toHaveText("notes/report.md");
  for (const name of ["Mostrar en Finder", "Abrir en su app", "Descargar"])
    await expect(panel.getByRole("button", { name })).toBeVisible();

  await panel.getByRole("button", { name: /Todos los documentos/ }).click();
  const row = panel.locator(".documentpanel__row");
  const actions = row.locator(".documentpanel__rowactions");
  await expect(actions).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(actions.getByRole("button", { name: "Abrir en su app" })).toBeVisible();
});
