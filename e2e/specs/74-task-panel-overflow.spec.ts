import { expect, open, rpc, test } from "./kit.ts";

for (const width of [1280, 590, 390]) {
  test(`task properties truncate long values without horizontal scrolling at ${width}px`, async ({ page }) => {
    await rpc("setup.finish", {});
    const name = `Northwind ${"implementation planning ".repeat(2)}`;
    const { project } = await rpc<{ project: { id: string } }>("projects.create", { name });
    const parent = await rpc<{ id: string }>("tasks.create", {
      title: `Prepare ${"long-parent-title".repeat(10)}`,
      project: project.id,
    });
    const title = `Review narrow task properties ${width}`;
    await rpc("tasks.create", { title, project: project.id, parent: parent.id });
    await page.setViewportSize({ width, height: 800 });
    await open(page, `#project=${project.id}&tab=tasks`);
    await page.locator(".taskrow").getByText(title, { exact: true }).click();
    const drawer = page.getByRole("complementary", { name: title });
    const body = drawer.locator(".taskpanel__body");
    const parentLink = drawer.locator(".taskprops__value > .taskwork__chat");
    await expect(parentLink).toBeVisible();
    await expect(drawer.getByRole("combobox", { name: "Proyecto", exact: true })).toContainText(name.trim());
    await expect.poll(() => body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    for (const value of [
      parentLink.locator(".taskwork__title"),
      drawer.locator(".apx-select__value").filter({ hasText: name.trim() }),
    ]) {
      await expect(value).toHaveCSS("text-overflow", "ellipsis");
      expect(await value.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }
    await parentLink.click();
    await expect(drawer).toBeHidden();
    await expect(page.locator(".taskpanel__title")).toHaveValue(`Prepare ${"long-parent-title".repeat(10)}`);
  });
}
