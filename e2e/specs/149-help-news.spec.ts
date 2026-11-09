// The Help menu's news: each entry not opened yet carries a dot, and loses it once opened; the button keeps its own
// dot while any is left, and All the news counts the unread ones the menu has no line for.
import { expect, open, test } from "./kit.ts";

const entry = (id: string, since: string, es: string) => ({
  id,
  since,
  title: { en: es, es },
  about: { en: "About it.", es: "De qué se trata." },
  seen: true,
  applies: true,
  actions: [],
});

test("news the owner has not opened keep their dot until each one is opened", async ({ page }) => {
  const entries = [
    entry("acme-review", "9.9.9", "Revisión de Acme"),
    entry("acme-limits", "9.9.9", "Límites de Acme"),
    entry("acme-tables", "9.9.9", "Tablas de Acme"),
    entry("acme-hidden", "9.9.9", "Cuarta de Acme"),
    entry("acme-old", "9.9.8", "Algo de antes"),
  ];
  await page.route("**/rpc/system.news", (route) => route.fulfill({ json: { ok: true, result: { entries } } }));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("apx.e2e.started")) {
      localStorage.removeItem("apx.newsRead");
      sessionStorage.setItem("apx.e2e.started", "1");
    }
  });
  await open(page);
  const help = page.getByRole("button", { name: "Ayuda · hay novedades" });
  const item = (title: string) => page.getByRole("menuitem", { name: new RegExp(title) });
  const unread = (title: string) => item(title).getByRole("img", { name: "Nueva" });
  const closeNews = () =>
    page.getByRole("dialog", { name: "Novedades" }).getByRole("button", { name: "Cerrar" }).click();

  // The newest release is new; the older one counts as read.
  await help.click();
  await expect(unread("Revisión de Acme")).toBeVisible();
  await expect(unread("Límites de Acme")).toBeVisible();
  await expect(item("Algo de antes")).toHaveCount(0);
  // The fourth new one has no line: All the news says so, and the button's hint says where to go.
  await expect(item("Todas las novedades")).toContainText("1 más sin ver");
  await expect(help).toHaveAccessibleDescription(/Todas las novedades las marca como vistas/);

  // Opening one reads only it: the other keeps its dot, and so does the button.
  await item("Revisión de Acme").click();
  await closeNews();
  await help.click();
  await expect(unread("Revisión de Acme")).toHaveCount(0);
  await expect(unread("Límites de Acme")).toBeVisible();
  await page.keyboard.press("Escape");

  // Kept on this device.
  await page.reload();
  await page.getByRole("button", { name: "Ayuda · hay novedades" }).click();
  await expect(unread("Revisión de Acme")).toHaveCount(0);
  await expect(unread("Límites de Acme")).toBeVisible();

  // Every release opened: nothing is left, the button is plain Help again.
  await item("Todas las novedades").click();
  await closeNews();
  await expect(page.getByRole("button", { name: "Ayuda", exact: true })).toBeVisible();
});
