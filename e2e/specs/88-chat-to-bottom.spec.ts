// Scrolled up in a long chat (the app's or a contact's in its channel), a button floats over the end and takes the reader
// back to the latest message.
import { expect, open, rpc, test, until, world } from "./kit.ts";

test("scrolled up, a button goes back to the latest message and hides there", async ({ page }) => {
  await rpc("setup.finish", {});
  const t = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Long read" });
  const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of the Northwind notes`).join("\n");
  await rpc("threads.send", { thread: t.id, text: lines });
  await page.setViewportSize({ width: 1024, height: 640 });
  await open(page, `#view=inbox&thread=${t.id}`);

  const scroller = page.getByRole("main").locator(".chat__scroll");
  const toBottom = page.getByRole("button", { name: "Ir al último mensaje" });
  const atEnd = () => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);
  // The answer is the last thing in the chat (the fake model echoes the last line); waiting for it keeps one match.
  await expect(page.getByText("Got it: Line 60 of the Northwind notes")).toBeInViewport();
  await expect.poll(atEnd).toBe(true);
  await expect(toBottom).toBeHidden();

  await scroller.hover();
  await page.mouse.wheel(0, -10000);
  await expect(toBottom).toBeVisible();
  await expect(toBottom).toBeInViewport();

  await toBottom.click();
  await expect.poll(atEnd).toBe(true);
  await expect(toBottom).toBeHidden();
});

test("a contact's chat in its channel scrolls the same way, with the same button", async ({ page }) => {
  const nadia = { phone: "5491100000088@s.whatsapp.net", name: "Nadia" };
  const person = await rpc<{ id: string }>("contacts.set", { name: "Nadia" });
  await rpc("contacts.address", { channel: "whatsapp", address: "+54 9 11 0000-0088", person: person.id });
  const lines = Array.from({ length: 60 }, (_, i) => `Item ${i + 1} of the Acme order`).join("\n");
  await world.whatsapp.message(nadia, lines);
  await until(async () => (await world.whatsapp.sentTo(nadia.phone)).length > 0);
  await page.setViewportSize({ width: 1024, height: 640 });
  await open(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await page.locator(".chan__rows").getByRole("button", { name: /Nadia/ }).click();

  const scroller = page.locator(".chan__msgs");
  const toBottom = page.getByRole("button", { name: "Ir al último mensaje" });
  const atEnd = () => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);
  await expect(page.locator(".chan__bubble").last()).toBeVisible();
  await expect.poll(atEnd).toBe(true);
  await expect(toBottom).toBeHidden();

  await scroller.hover();
  await page.mouse.wheel(0, -10000);
  await expect(toBottom).toBeVisible();
  await toBottom.click();
  await expect.poll(atEnd).toBe(true);
  await expect(toBottom).toBeHidden();
});
