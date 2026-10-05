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
