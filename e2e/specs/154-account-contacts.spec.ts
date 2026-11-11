// An account's list in the Inbox ends with its saved contacts nobody wrote to yet: picking one opens a chat to write
// them right there, and what is sent first makes it a chat of the list. WhatsApp is linked by 10-whatsapp.
import { ACCOUNT_NAME, expect, open, rpc, test, until, world } from "./kit.ts";

const IRIS = "5491100000021@s.whatsapp.net";

test("an account's list keeps its contacts with no chat, and one is written to from there", async ({ page }) => {
  const iris = await rpc<{ id: string }>("contacts.set", { name: "Iris" });
  await rpc("contacts.address", { channel: "whatsapp", address: "+54 9 11 0000-0021", person: iris.id });

  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: ACCOUNT_NAME.whatsapp, exact: true }).first().click();
  const back = page.getByRole("button", { name: "Volver a los chats", exact: true });
  if (await back.isVisible()) await back.click();
  const list = page.locator(".inbox__list");
  const row = list.locator(".threadrow", { hasText: "Iris" });
  await expect(row).toContainText("+5491100000021");
  // Contacts with no chat go after the account's chats (which say when they were written).
  const order = await list
    .locator(".threadrow")
    .evaluateAll((rows) => rows.map((r) => (r.querySelector(".apx-convrow__time") ? "chat" : r.textContent)));
  expect(order.indexOf("chat")).toBe(0);
  expect(order.lastIndexOf("chat")).toBeLessThan(order.findIndex((r) => r?.includes("Iris")));
  // The search finds them too.
  const find = page.locator(".inbox__accountfind input");
  await find.fill("iri");
  await expect(list.locator(".threadrow")).toHaveCount(1);
  await find.fill("");
  await page.screenshot({ path: "test-results/inbox-account-contacts.png" });

  // Picked, their chat opens beside the list, still in the Inbox.
  await row.click();
  await expect(page.getByText("Todavía no hay mensajes con Iris")).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "true");
  expect(page.url()).not.toContain("channel=");
  await page.screenshot({ path: "test-results/inbox-account-contact-open.png" });

  const box = page.getByRole("textbox", { name: /que le escriba a Iris/ });
  await box.fill("decile hola a Iris");
  await box.press("Enter");
  await until(async () => (await world.whatsapp.sentTo(IRIS)).some((t) => t.startsWith("Got it:")));
  // What was sent made their chat: the list shows it as one, and it stays open here.
  await expect(page.locator(".chan__bubble.is-out").last()).toBeVisible();
  await expect.poll(() => page.url()).toContain("thread=");
  await expect(list.locator(".threadrow", { hasText: "Iris" })).toHaveCount(1);
  await expect(list.locator(".threadrow", { hasText: "Iris" })).not.toContainText("Sin conversación");

  // On a phone the chat covers the list; its arrow leads back to it.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator(".chan").getByRole("button", { name: "Volver a los contactos", exact: true }).click();
  await expect(list.locator(".threadrow", { hasText: "Iris" })).toBeVisible();
  await page.screenshot({ path: "test-results/inbox-account-contacts-phone.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
