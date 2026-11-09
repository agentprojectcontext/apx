// The Inbox's header: New chat, then search and filter, small. Searching takes the tabs' place so the list stays
// where it is; the filter picks agents or projects, with no other way of listing chats.
import { expect, open, test } from "./kit.ts";

test("search opens over the tabs without moving the list, and closes back to them", async ({ page }) => {
  await open(page);
  const inbox = page.getByRole("region", { name: "Inbox" });
  const x = async (name: string, role: "button" | "combobox" = "button") =>
    (await inbox.getByRole(role, { name }).boundingBox())?.x ?? -1;
  expect(await x("Nuevo chat", "combobox")).toBeLessThan(await x("Buscar chats"));
  expect(await x("Buscar chats")).toBeLessThan(await x("Filtrar chats"));
  const list = inbox.locator(".inbox__list");
  const before = (await list.boundingBox())?.y;

  await inbox.getByRole("button", { name: "Buscar chats" }).click();
  const field = inbox.getByPlaceholder("Buscar chats");
  await expect(field).toBeFocused();
  await expect(inbox.getByRole("radiogroup", { name: "Mostrar" })).toHaveCount(0);
  expect((await list.boundingBox())?.y).toBe(before);
  await field.fill("zzz-nothing");
  await expect(inbox.getByText("Sin resultados")).toBeVisible();

  await field.press("Escape");
  await expect(inbox.getByRole("radiogroup", { name: "Mostrar" })).toBeVisible();
  await expect(inbox.getByText("Sin resultados")).toHaveCount(0);

  // An empty search closes once the field is left; the × closes one with words.
  await inbox.getByRole("button", { name: "Buscar chats" }).click();
  await inbox.locator(".inbox__title").click();
  await expect(inbox.getByRole("radiogroup", { name: "Mostrar" })).toBeVisible();
  await inbox.getByRole("button", { name: "Buscar chats" }).click();
  await inbox.getByPlaceholder("Buscar chats").fill("zzz");
  await inbox.getByRole("button", { name: "Cerrar la búsqueda" }).click();
  await expect(inbox.getByRole("radiogroup", { name: "Mostrar" })).toBeVisible();
});

test("the filter picks agents or projects, with no view picker", async ({ page }) => {
  await open(page);
  await page.getByRole("region", { name: "Inbox" }).getByRole("button", { name: "Filtrar chats" }).click();
  const filter = page.getByRole("dialog", { name: "Filtrar chats" });
  await expect(filter.getByRole("tab", { name: "Agentes" })).toBeVisible();
  await expect(filter.getByRole("combobox")).toHaveCount(0);
  await expect(filter.getByText("Lista")).toHaveCount(0);
});
