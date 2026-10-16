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
  await top.locator(".tree__session").click();
  await expect(top.locator(".tree__session.is-selected")).toHaveCount(1);
});
