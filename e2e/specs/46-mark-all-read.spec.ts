import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Marcar todo como leído: desde la Bandeja y desde el menú del proyecto", async ({ page }) => {
  const a = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Sin leer A" });
  const b = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Sin leer B" });
  const unread = new Map([
    [a.id, 2],
    [b.id, 3],
  ]);
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // Unread left by earlier specs would change the counts checked here.
    body.result.threads = body.result.threads.map((thread: { id: string }) => ({
      ...thread,
      unread: unread.get(thread.id) ?? 0,
    }));
    await route.fulfill({ response, json: body });
  });
  const read: string[] = [];
  await page.route("**/rpc/threads.read", async (route) => {
    const thread = (route.request().postDataJSON() as { thread: string }).thread;
    // Opening the app can also acknowledge Home; only these chats belong to the bulk action.
    if (thread === a.id || thread === b.id) read.push(thread);
    unread.delete(thread);
    await route.continue();
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#view=inbox");
  const inbox = page.locator(".sidebar__top").getByRole("button", { name: /^Inbox/, includeHidden: true });
  await expect(inbox.locator(".apx-nav__count")).toHaveText("5");
  const all = page.getByRole("button", { name: "Marcar todo como leído", exact: true });
  const dialog = page.getByRole("dialog", { name: "Marcar todo como leído", exact: true });
  await all.click();
  await expect(dialog).toContainText("Chats que se marcarán como leídos: 2.");
  expect(read).toEqual([]);
  await expect(inbox.locator(".apx-nav__count")).toHaveText("5");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(read).toEqual([]);
  await expect(inbox.locator(".apx-nav__count")).toHaveText("5");
  await all.click();
  await dialog.getByRole("button", { name: "Marcar todo como leído", exact: true }).click();
  await expect.poll(() => [...read].sort()).toEqual([a.id, b.id].sort());
  await expect(inbox.locator(".apx-nav__count")).toHaveCount(0);
  await expect(all).toBeDisabled();

  // Inbox unread counts can also be cleared from its sidebar context menu.
  unread.set(a.id, 2);
  unread.set(b.id, 3);
  read.length = 0;
  await page.reload();
  await expect(inbox.locator(".apx-nav__count")).toHaveText("5");
  await inbox.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Marcar todo como leído", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(read).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(read).toEqual([]);
  await expect(inbox.locator(".apx-nav__count")).toHaveText("5");
  await inbox.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Marcar todo como leído", exact: true }).click();
  await dialog.getByRole("button", { name: "Marcar todo como leído", exact: true }).click();
  await expect.poll(() => [...read].sort()).toEqual([a.id, b.id].sort());
  await expect(inbox.locator(".apx-nav__count")).toHaveCount(0);

  // The project's dot goes the same way, from its own menu.
  unread.set(a.id, 1);
  read.length = 0;
  await page.reload();
  await expect(inbox.locator(".apx-nav__count")).toHaveText("1");
  const row = page.locator(".sidebar__scroll [data-project-id]").filter({ has: page.locator(".sidebar__unread") });
  await expect(row).toHaveCount(1);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Marcar todo como leído", exact: true }).click();
  await expect(dialog).toContainText("Chats que se marcarán como leídos: 1.");
  expect(read).toEqual([]);
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(read).toEqual([]);
  await expect(inbox.locator(".apx-nav__count")).toHaveText("1");
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Marcar todo como leído", exact: true }).click();
  await dialog.getByRole("button", { name: "Marcar todo como leído", exact: true }).click();
  await expect.poll(() => read).toEqual([a.id]);
  await expect(page.locator(".sidebar__unread")).toHaveCount(0);
  await expect(inbox.locator(".apx-nav__count")).toHaveCount(0);
});
