import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Marcar todo como leído: desde la Bandeja y desde el menú del proyecto", async ({ page }) => {
  const a = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: "Sin leer A" });
  const b = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: "Sin leer B" });
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
  const dialog = page.getByRole("dialog", { name: "Marcar todo como leído", exact: true });

  // Inbox unread counts are cleared from its sidebar context menu.
  await inbox.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Marcar todo como leído", exact: true }).click();
  await expect(dialog).toContainText("Chats que se marcarán como leídos: 2.");
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

test.describe("barra compacta", () => {
  test.use({ compactSidebar: true });

  test("Marcar como leído una pestaña de la Bandeja o una sección; un canal abre su propio menú", async ({ page }) => {
    const chat = await rpc<{ id: string }>("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Suelto",
    });
    const task = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: "Tarea" });
    const unread = new Map([
      [chat.id, 2],
      [task.id, 3],
    ]);
    await page.route("**/rpc/threads.list", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.result.threads = body.result.threads.map((thread: { id: string }) => ({
        ...thread,
        unread: unread.get(thread.id) ?? 0,
        // A chat an agent keeps for a task: listed under Tasks, not under Chats.
        ...(thread.id === task.id ? { task_id: "task_northwind" } : {}),
      }));
      await route.fulfill({ response, json: body });
    });
    await page.route("**/rpc/channels.list", (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            channels: [
              {
                id: "telegram",
                type: "telegram",
                label: "Acme Desk",
                enabled: true,
                agent_id: "superagent",
                strangers: "pair",
                concurrency: "queue",
                owner_thread: "own",
                token_set: true,
                status: "running",
              },
            ],
          },
        },
      }),
    );
    const read: string[] = [];
    await page.route("**/rpc/threads.read", async (route) => {
      const thread = (route.request().postDataJSON() as { thread: string }).thread;
      if (thread === chat.id || thread === task.id) read.push(thread);
      unread.delete(thread);
      await route.continue();
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "#view=inbox");
    const tab = (name: string) =>
      page.getByRole("region", { name: "Inbox" }).getByRole("radio", { name: new RegExp(`^${name}`) });
    const markAll = page.getByRole("menuitem", { name: "Marcar todo como leído", exact: true });
    const dialog = page.getByRole("dialog", { name: "Marcar todo como leído", exact: true });
    const confirm = dialog.getByRole("button", { name: "Marcar todo como leído", exact: true });

    // A tab's own menu reads only that tab's chats.
    await tab("Tareas").click({ button: "right" });
    await markAll.click();
    await expect(dialog).toContainText("Chats que se marcarán como leídos: 1.");
    await confirm.click();
    await expect.poll(() => read).toEqual([task.id]);
    await tab("Chats").click({ button: "right" });
    await markAll.click();
    await confirm.click();
    await expect.poll(() => read).toEqual([task.id, chat.id]);
    await expect(tab("Chats")).toBeChecked();

    // A section's row: its "Mark all as read" first, then the sidebar's own menu.
    unread.set(chat.id, 1);
    read.length = 0;
    await page.reload();
    const section = (name: string) => page.locator(".sidebar__scroll").getByRole("button", { name, exact: true });
    await section("Proyectos").click({ button: "right" });
    await expect(page.getByRole("menu")).toContainText("Vistas");
    await markAll.click();
    await expect(dialog).toContainText("Chats que se marcarán como leídos: 1.");
    await confirm.click();
    await expect.poll(() => read).toEqual([chat.id]);
    await section("Sesiones externas").click({ button: "right" });
    await expect(markAll).toBeDisabled();
    await page.keyboard.press("Escape");

    // A channel in the section's flyout keeps its own menu, not the sidebar's.
    await section("Canales").hover();
    await page.locator('[data-channel-id="telegram"]').click({ button: "right" });
    const openItem = page.getByRole("menuitem", { name: "Abrir", exact: true });
    await expect(openItem).toBeVisible();
    await expect(page.getByRole("menu")).not.toContainText("Vistas");
    // Resting on the menu (outside the flyout) keeps both open, past the flyout's hover delay.
    await openItem.hover();
    await page.waitForTimeout(600);
    await expect(openItem).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Marcar todo como leído", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(openItem).toHaveCount(0);

    // A pick inside the flyout closes it, even when it keeps the place shown (an account narrows the Inbox already
    // narrowed to it): once from the row, once from its menu's "Open".
    const flyout = page.getByRole("dialog", { name: "Canales" });
    for (const how of ["row", "menu"] as const) {
      await section("Canales").hover();
      await expect(flyout).toBeVisible();
      const row = page.locator('[data-channel-id="telegram"]');
      if (how === "row") await row.getByRole("button").first().click();
      else {
        await row.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Abrir", exact: true }).click();
      }
      await expect(flyout).toBeHidden();
      await page.mouse.move(900, 500);
    }
  });
});
