import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Chats: un chat sin leer se distingue en la lista y deja de serlo al abrirlo", async ({ page }) => {
  const ids: string[] = [];
  for (let i = 0; i < 5; i++)
    ids.push(
      (await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: `Arriba ${i}` })).id,
    );
  const old = ids[0] ?? "";
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // The oldest one is unread: it sits last in the list by activity.
    body.result.threads = body.result.threads.map((thread: { id: string }) => ({
      ...thread,
      unread: thread.id === old ? 2 : 0,
    }));
    await route.fulfill({ response, json: body });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#view=inbox");
  const rows = page.locator(".inbox__list .apx-convrow");
  const row = (title: string) => rows.filter({ hasText: title });
  await expect(row("Arriba 4")).toHaveCount(1);
  // Only the unread one carries the badge with its count.
  await expect(rows.locator(".apx-convrow__unread")).toHaveCount(1);
  await expect(row("Arriba 0")).toHaveClass(/is-unread/);
  await expect(row("Arriba 0").locator(".apx-convrow__unread")).toHaveText("2");
  await expect(row("Arriba 4")).not.toHaveClass(/is-unread/);
  // Opening it reads it: from now on the core says so.
  await page.unroute("**/rpc/threads.list");
  await row("Arriba 0").click();
  // Loaded, the chat marks itself read.
  await expect(page.getByText(/^Chat con /)).toBeVisible();
  await expect(row("Arriba 0")).toHaveClass(/is-selected/);
  await row("Arriba 4").first().click();
  await expect(rows.locator(".apx-convrow__unread")).toHaveCount(0);
});

test("Chats: una sesión de Claude Code sin leer se muestra con su motor, no con el agente que la aloja", async ({
  page,
}) => {
  const { id } = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    title: "Revisión",
  });
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.threads = body.result.threads.map((thread: { id: string }) =>
      thread.id === id
        ? { ...thread, engine: "claude", kind: "code", cwd: "~/work/acme", unread: 1 }
        : { ...thread, unread: 0 },
    );
    await route.fulfill({ response, json: body });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#view=inbox");
  const row = page.locator(".inbox__list .apx-convrow.is-unread");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Revisión");
  await expect(row.locator(".apx-engine--claude")).toHaveCount(1);
  await expect(row.locator(".apx-blob, .apx-avatar")).toHaveCount(0);
});
