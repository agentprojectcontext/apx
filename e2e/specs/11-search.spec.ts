// ⌘K: one box to jump anywhere — a project, a task, a place of the app — by keyboard, accents or not.
import { expect, open, rpc, test, until } from "./kit.ts";

test("⌘K finds a project, a task and a settings section, and Enter goes there", async ({ page }) => {
  const similar = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    title: "Northwind landing",
  });
  try {
    await open(page);
    await page.keyboard.press("ControlOrMeta+k");
    const box = page.getByRole("combobox", { name: "Buscar" }).or(page.getByRole("textbox", { name: "Buscar" }));
    await expect(box).toBeFocused();

    await box.fill("northw");
    const project = page.getByRole("option").filter({ has: page.getByText("Northwind", { exact: true }) });
    await expect(project).toBeVisible();
    await expect(
      page
        .getByRole("option")
        .filter({ has: page.getByText("Northwind landing", { exact: true }) })
        .first(),
    ).toBeVisible();
    // Matching chats may precede the project; navigate to the intended result before accepting it.
    const titles = await page.getByRole("option").locator(".palette__title").allTextContents();
    const index = titles.indexOf("Northwind");
    expect(index).toBeGreaterThan(0);
    expect(titles.slice(0, index)).toContain("Northwind landing");
    for (let i = 0; i < index; i++) await box.press("ArrowDown");
    await expect(project).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(page.getByRole("heading", { name: "Northwind" })).toBeVisible();

    await page.getByRole("button", { name: "Buscar o saltar a…" }).click();
    await box.fill("invoice");
    await expect(page.getByRole("option", { name: /Ship the invoice page/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();

    // Accents do not matter: "configuracion" finds the settings sections.
    await page.keyboard.press("ControlOrMeta+k");
    await box.fill("canales configuracion");
    await page.getByRole("option", { name: /Canales/ }).click();
    await expect(page.getByRole("dialog", { name: "Configuración" })).toBeVisible();
  } finally {
    await rpc("threads.delete", { thread: similar.id });
  }
});

test("⌘K finds words inside messages, accents aside, and opens the chat at that message", async ({ page }) => {
  const thread = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    title: "Zoología",
  });
  await rpc("threads.send", { thread: thread.id, text: "Anotá que el ornitorrinco come camarones" });
  await until(async () => (await rpc<{ hits: unknown[] }>("threads.search", { query: "ornitorrinco" })).hits.length);
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const box = page.getByRole("combobox", { name: "Buscar" }).or(page.getByRole("textbox", { name: "Buscar" }));
  await box.fill("ORNITO camaron");
  const hit = page.getByRole("option", { name: /el ornitorrinco come camarones.*Zoología/ }).first();
  await expect(hit).toBeVisible();
  await expect(page.getByText("En los mensajes")).toBeVisible();
  await hit.click();
  await expect(box).toBeHidden();
  const row = page.locator(".transcript__row", { hasText: "el ornitorrinco come camarones" }).first();
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/is-flash/);
});
