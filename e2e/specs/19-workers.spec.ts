// An agent can start a worker for a task: the chat shows its row with its state and how long it took; the row unfolds
// the whole report, with the way into the worker's session at its foot.
import { expect, open, test } from "./kit.ts";

test("a worker's report unfolds from its row in the chat, which says how long it took", async ({ page }) => {
  await open(page);
  const main = page.getByRole("main");
  const composer = main.getByRole("textbox").last();
  await composer.fill("start a worker to check the sources");
  await composer.press("Enter");

  const card = main.locator(".apx-subthread").last();
  await expect(card.getByText("Listo")).toBeVisible();
  await expect(card.getByText(/→ Researcher · Ayudante/)).toBeVisible();
  await expect(card.locator(".apx-subthread__time")).toHaveText(/^\d+ s$/);
  const row = card.getByRole("button", { name: /→ Researcher/ });
  await expect(card.locator(".apx-subthread__summary")).toHaveCount(0);
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByText("Last line of the report.")).toBeVisible();
  await row.click();
  await expect(card.locator(".apx-subthread__summary")).toHaveCount(0);
  await row.click();

  await card.getByRole("button", { name: "Abrir el chat de Researcher" }).click();
  await expect(page.getByText("check the sources").first()).toBeVisible();
});
