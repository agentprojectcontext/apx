import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Árbol: los chats sin leer se repiten arriba, aunque queden bajo «Ver más»", async ({ page }) => {
  const ids: string[] = [];
  for (let i = 0; i < 5; i++)
    ids.push(
      (await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: `Arriba ${i}` })).id,
    );
  const old = ids[0] ?? "";
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // The oldest one is unread: in its branch it sits under "N more".
    body.result.threads = body.result.threads.map((thread: { id: string }) => ({
      ...thread,
      unread: thread.id === old ? 2 : 0,
    }));
    await route.fulfill({ response, json: body });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#view=inbox");
  const top = page.locator(".tree__unreadlist");
  await expect(top.locator(".tree__session")).toHaveCount(1);
  await expect(top.locator(".tree__session")).toContainText("Arriba 0");
  // Its branch keeps it where it was: hidden until "more".
  const branch = page.locator(".tree__agent").filter({ hasText: "Arriba 4" });
  await expect(branch.locator(".tree__session", { hasText: "Arriba 0" })).toHaveCount(0);
  // Opening it reads it: from now on the core says so. It stays on top while open, then leaves.
  await page.unroute("**/rpc/threads.list");
  await top.locator(".tree__session").click();
  // Loaded, the chat marks itself read.
  await expect(page.getByText(/^Chat con /)).toBeVisible();
  await expect(top.locator(".tree__session.is-selected")).toHaveCount(1);
  await page.locator(".tree__session", { hasText: "Arriba 4" }).first().click();
  await expect(page.locator(".tree__unreadlist")).toHaveCount(0);
});

test("Árbol: una sesión de Claude Code sin leer se muestra con su motor, no con el agente que la aloja", async ({
  page,
}) => {
  const { id } = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Revisión" });
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
  const row = page.locator(".tree__unreadlist .tree__session");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".apx-engine--claude")).toHaveCount(1);
  await expect(row.locator(".apx-blob, .apx-avatar")).toHaveCount(0);
  await expect(row.locator(".tree__sessionwho")).toHaveText("Claude Code");
});
