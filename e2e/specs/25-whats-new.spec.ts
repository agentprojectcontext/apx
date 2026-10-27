// After an update the super-agent tells what changed in a chat of its own, and "See what's new" in the top bar opens
// it until it is read. The core writes that chat on its first start of a newer release (apps/core whats-new tests);
// here the sandbox's core is on no newer release, so its list marks a chat as that one.
import type { Route } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("no pill while no update was told", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Ver cambios" })).toBeHidden();
});

test("See what's new opens the chat that tells the update, and goes once it is read", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "agent",
    agent_id: "roby",
    title: "Novedades de APX 9.9.9",
  });
  await page.route("**/rpc/threads.list", async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { ok: boolean; result: { threads: Array<Record<string, unknown>> } };
    const threads = body.result.threads.map((t) => (t.id === chat.id ? { ...t, release: "9.9.9", unread: 1 } : t));
    await route.fulfill({ response: res, json: { ...body, result: { ...body.result, threads } } });
  });
  await open(page);
  const pill = page.getByRole("button", { name: "Ver cambios" });
  await pill.hover();
  const hint = page.locator(".apx-tooltip", { hasText: "Novedades de APX 9.9.9" });
  await expect(hint).toBeVisible();
  await expect(hint).toBeInViewport();
  await pill.click();
  await expect(page.locator(".topbar__crumb.is-last")).toHaveText("Novedades de APX 9.9.9");
  await expect(pill).toBeHidden();
});
