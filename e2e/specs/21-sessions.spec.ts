// A chat's own menu: right-click a session in any Inbox view (or the chat header's "…") to pin, rename, archive or
// delete it.
import { expect, open, rpc, test } from "./kit.ts";

test("right-click a session: pin it to the top, rename it, archive and unarchive it, delete another", async ({
  page,
}) => {
  // Alone (without the setup spec first) the sandbox is a fresh install: its first-run setup would cover the panel.
  await rpc("setup.finish", {});
  const alfa = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Sesión Alfa" });
  const beta = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Sesión Beta" });
  await open(page);
  const menuItem = (name: string) => page.getByRole("menuitem", { name });

  // Tree: pinning moves the session to the top of its agent's list, with a pin on it.
  const branch = page.locator(".tree__agent", { hasText: "Sesión Beta" });
  await expect(branch.locator(".tree__session").first()).toContainText("Sesión Beta");
  await branch.locator(".tree__session", { hasText: "Sesión Alfa" }).click({ button: "right" });
  await menuItem("Fijar arriba").click();
  await expect(branch.locator(".tree__session").first()).toContainText("Sesión Alfa");
  await expect(branch.locator(".tree__session").first().getByRole("img", { name: "Fijado" })).toBeVisible();

  // Activity: pinned chats lead the list.
  await page.getByRole("radio", { name: "Actividad" }).click();
  await expect(page.locator(".activity__row").first()).toContainText("Sesión Alfa");

  // By chat: rename through the menu's dialog; an empty name goes back to the automatic title.
  await page.getByRole("radio", { name: "Por chat" }).click();
  const row = (text: string) => page.locator(".inbox__list .apx-convrow", { hasText: text });
  await row("Sesión Alfa").click({ button: "right" });
  await menuItem("Renombrar").click();
  const rename = page.getByRole("dialog", { name: "Renombrar chat" });
  await rename.getByRole("textbox", { name: "Nombre" }).fill("Plan de viaje");
  await rename.getByRole("button", { name: "Guardar" }).click();
  await expect(rename).toBeHidden();
  await expect(row("Plan de viaje")).toBeVisible();
  await row("Plan de viaje").click({ button: "right" });
  await menuItem("Renombrar").click();
  await expect(rename.getByRole("textbox", { name: "Nombre" })).toHaveValue("Plan de viaje");
  await rename.getByRole("textbox", { name: "Nombre" }).fill("");
  await rename.getByRole("button", { name: "Guardar" }).click();
  await expect(row("Sesión Alfa")).toBeVisible();

  // Archive: out of the list, kept under Archived, back with Unarchive.
  await row("Sesión Alfa").click({ button: "right" });
  await menuItem("Archivar").click();
  await expect(row("Sesión Alfa")).toBeHidden();
  await page.getByRole("button", { name: /Archivados/ }).click();
  const archived = page.locator(".inbox__archived .apx-convrow", { hasText: "Sesión Alfa" });
  await expect(archived).toBeVisible();
  await archived.click({ button: "right" });
  await menuItem("Desarchivar").click();
  await expect(page.locator(".inbox__archived")).toHaveCount(0);
  await expect(row("Sesión Alfa")).toBeVisible();

  // Delete asks first, then the chat is gone for good.
  await row("Sesión Beta").click({ button: "right" });
  await menuItem("Borrar").click();
  const confirm = page.getByRole("dialog", { name: "Borrar chat" });
  await expect(confirm).toContainText("Esta acción no se puede deshacer.");
  await confirm.getByRole("button", { name: "Borrar" }).click();
  await expect(confirm).toBeHidden();
  await expect(row("Sesión Beta")).toBeHidden();
  await expect(rpc("threads.get", { thread: beta.id })).rejects.toThrow(/not found/);

  await rpc("threads.delete", { thread: alfa.id });
});

test("the chat header's menu starts with Pin; the main chat cannot be archived or deleted", async ({ page }) => {
  await open(page, "#thread=home");
  await page.locator(".chat__header").getByRole("button", { name: "Más" }).click();
  const items = page.getByRole("menuitem");
  await expect(items.first()).toHaveText(/Fijar arriba|Desfijar/);
  await expect(page.getByRole("menuitem", { name: "Resumir turnos anteriores" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Borrar" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("menuitem", { name: "Archivar" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("El chat principal no se puede archivar ni borrar")).toBeVisible();
});
