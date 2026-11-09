// Asked for something an app or channel that is not connected would do, the agent offers it on a card: an app's form
// opens right there, a channel's setup opens in Settings; once connected, the agent goes on by itself.
import { expect, open, rpc, test } from "./kit.ts";

async function ask(page: Parameters<typeof open>[0], text: string) {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Conectar" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill(text);
  await page.keyboard.press("Enter");
  return page.locator(".connectcard");
}

test("an app that is not connected is offered, and its form opens from the chat", async ({ page }) => {
  const card = await ask(page, "connect figma for me");
  await expect(card).toContainText("Conexiones sugeridas");
  await expect(card).toContainText("To work with your figma for you.");
  await expect(card).toContainText("Figma");
  await card.getByRole("button", { name: "Conectar" }).click();
  const form = page.getByRole("dialog", { name: "Conectar Figma" });
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Cancelar" }).click();
  await expect(form).toHaveCount(0);

  // The rest of the catalog, one line under the offers: it opens the catalog right there.
  await card.getByRole("button", { name: /Explorar \d+ conectores más/ }).click();
  const catalog = page.getByRole("dialog", { name: "Conectar una integración" });
  await expect(catalog).toContainText("GitHub");
});

test("a channel that is not set up is offered, and opens its setup in Settings", async ({ page }) => {
  const card = await ask(page, "connect matrix for me");
  await expect(card).toContainText("Matrix");
  await card.getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByRole("dialog")).toContainText("Matrix");
});

test("connecting what the card offers wakes the agent that offered it", async ({ page }) => {
  const card = await ask(page, "connect github for me");
  await expect(card).toContainText("GitHub");
  // The agent's turn ends after the card: it is waiting for the owner, not working.
  await expect(page.getByText(/Got it: connect github for me/)).toBeVisible();
  await card.getByRole("button", { name: "Conectar" }).click();
  const form = page.getByRole("dialog", { name: "Conectar GitHub" });
  await form.getByLabel(/token/i).fill("ghp_example0000");
  await form.getByRole("button", { name: "Conectar" }).click();
  await expect(form).toHaveCount(0);
  await expect(card.getByText("Conectado")).toBeVisible();
  await expect(page.getByText(/the owner connected .*GitHub/)).toBeVisible();
  await rpc("integrations.disconnect", { id: "github" });
});
