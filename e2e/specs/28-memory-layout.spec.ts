// A long memory: only the list scrolls; the search box and "Add note" stay in view, the search box at its height.
import { expect, open, rpc, test } from "./kit.ts";

test("a project's memory with many notes scrolls its list only; search and Add note stay in view", async ({ page }) => {
  await rpc("setup.finish", {});
  for (let i = 1; i <= 40; i++)
    await rpc("memory.add", { text: `Northwind note ${i}: a decision worth keeping for later.`, scope: "global" });

  await page.setViewportSize({ width: 1100, height: 600 });
  await open(page, "#project=~default&tab=memory");
  const search = page.locator(".memory .apx-field");
  const add = page.getByRole("button", { name: "Agregar nota" });
  await expect(search).toBeInViewport();
  await expect(add).toBeInViewport();
  const height = (await search.boundingBox())?.height ?? 0;
  expect(height).toBeGreaterThanOrEqual(28);

  const list = page.locator(".memory__list");
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const last = list.getByText("Northwind note 1:", { exact: false });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(search).toBeInViewport();
  await expect(add).toBeInViewport();
  expect((await search.boundingBox())?.height).toBe(height);
});

test("what agents learned about the owner waits first in the list and is confirmed in one go", async ({ page }) => {
  await rpc("setup.finish", {});
  const at = "2026-11-01T10:00:00.000Z";
  const note = (id: string, text: string, pending: boolean) => ({
    id,
    scope: "global",
    text,
    source: pending ? "agent" : "owner",
    ...(pending ? { author_agent: "superagent" } : {}),
    pending,
    tainted: pending,
    created_at: at,
    updated_at: at,
  });
  let confirmed: string[] | undefined;
  await page.route("**/rpc/memory.list", async (route) => {
    const params = route.request().postDataJSON() ?? {};
    if (params.scope !== "global") return route.fallback();
    const waiting = !confirmed;
    await route.fulfill({
      json: {
        ok: true,
        result: {
          memories: [
            note("mem_own", "Northwind invoices go out on the first Monday.", false),
            note("mem_a", "The owner prefers short answers in the morning.", waiting),
            note("mem_b", "The owner signs emails with their first name.", waiting),
          ],
        },
      },
    });
  });
  await page.route("**/rpc/memory.confirm_all", async (route) => {
    confirmed = route.request().postDataJSON()?.ids;
    await route.fulfill({ json: { ok: true, result: { confirmed: confirmed?.length ?? 0 } } });
  });

  await open(page, "#project=~default&tab=memory");
  const rows = page.locator(".memory__row");
  await expect(rows.first()).toContainText("short answers");
  await expect(rows.nth(1)).toContainText("signs emails");
  await expect(rows.nth(2)).toContainText("invoices");
  await expect(page.getByText("Con contenido de afuera")).toHaveCount(0);
  await expect(page.getByText("2 para confirmar", { exact: false })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("memory-pending-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("memory-pending-phone.png") });

  await page.getByRole("button", { name: "Confirmar todas" }).click();
  await expect(page.getByRole("button", { name: "Confirmar todas" })).toHaveCount(0);
  expect(confirmed).toEqual(["mem_a", "mem_b"]);
  await expect(page.getByText("Para confirmar", { exact: true })).toHaveCount(0);
});
