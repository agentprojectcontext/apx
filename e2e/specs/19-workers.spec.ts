// An agent can start a worker for a task: the chat shows its card with the whole report, folded until asked, and
// how long it took; the card's head opens the worker's session.
import { expect, open, test } from "./kit.ts";

test("a worker's report shows in the chat, folded, with how long it took", async ({ page }) => {
  await open(page);
  const main = page.getByRole("main");
  const composer = main.getByRole("textbox").last();
  await composer.fill("start a worker to check the sources");
  await composer.press("Enter");

  const card = main.locator(".apx-subthread").last();
  await expect(card.getByText("Listo")).toBeVisible();
  await expect(card.getByText(/→ Researcher · Ayudante/)).toBeVisible();
  await expect(card.getByText(/^Tardó \d+ s$/)).toBeVisible();
  // Clipped text still counts as visible to the browser: the fold is read from the report's own state.
  const report = card.locator(".apx-subthread__summary");
  await expect(report).toHaveClass(/is-folded/);
  await card.getByRole("button", { name: "Mostrar más" }).click();
  await expect(report).not.toHaveClass(/is-folded/);
  await expect(card.getByText("Last line of the report.")).toBeVisible();
  await card.getByRole("button", { name: "Mostrar menos" }).click();
  await expect(report).toHaveClass(/is-folded/);

  await card.getByRole("button", { name: /Abrir conversación con Researcher/ }).click();
  await expect(page.getByText("check the sources").first()).toBeVisible();
});
