import { expect, open, rpc, test } from "./kit.ts";

for (const width of [1280, 850, 390]) {
  test(`project tasks scroll through expanded subtasks and keep controls at ${width}px`, async ({ page }) => {
    await rpc("setup.finish", {});
    const { project } = await rpc<{ project: { id: string } }>("projects.create", {
      name: `Northwind scroll ${width}`,
    });
    for (let i = 0; i < 30; i++)
      await rpc("tasks.create", {
        title: `Prepare item ${i}`,
        project: project.id,
        status: i % 2 ? "review" : "doing",
      });
    const parent = await rpc<{ id: string }>("tasks.create", { title: "Final parent", project: project.id });
    // Pending is the last open group (what needs the owner comes first): the parent's subtasks are the list's end.
    for (let i = 0; i < 8; i++)
      await rpc("tasks.create", { title: `Expanded child ${i}`, project: project.id, parent: parent.id });

    await page.setViewportSize({ width, height: 640 });
    await open(page, `#project=${project.id}&tab=tasks`);
    const list = page.locator(".tasks__main");
    const rows = list.locator(".taskrow");
    await expect(rows).toHaveCount(39);
    const first = rows.first();
    const last = rows.last();
    await expect(first).toBeInViewport();
    await expect(last).toContainText("Expanded child 7");
    await expect(last).not.toBeInViewport();
    const header = page.locator(".project__head");
    const controls = page.locator(".tasks__bar");
    const headerY = (await header.boundingBox())?.y;
    const controlsY = (await controls.boundingBox())?.y;

    await list.hover();
    await page.mouse.wheel(0, 10000);
    await expect(last).toBeInViewport();
    await expect(first).not.toBeInViewport();
    await expect(header).toBeInViewport();
    await expect(controls).toBeInViewport();
    expect((await header.boundingBox())?.y).toBe(headerY);
    expect((await controls.boundingBox())?.y).toBe(controlsY);
    const scrollTop = await list.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);

    await last.click();
    const drawer = page.getByRole("complementary", { name: "Expanded child 7" });
    await expect(drawer).toBeInViewport();
    await expect(drawer.getByRole("button", { name: "Hecha", exact: true })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(last).toBeInViewport();
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(scrollTop);
    await list.hover();
    await page.mouse.wheel(0, -10000);
    await expect(first).toBeInViewport();
    await expect(controls).toBeInViewport();
  });
}

test("short project task lists do not overflow", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Northwind short list" });
  await rpc("tasks.create", { title: "Only item", project: project.id });
  await open(page, `#project=${project.id}&tab=tasks`);
  await expect(page.getByText("Only item", { exact: true })).toBeInViewport();
  const list = page.locator(".tasks__main");
  expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
});

test("global tasks still scroll and open their detail", async ({ page }) => {
  await rpc("setup.finish", {});
  for (let i = 0; i < 30; i++) await rpc("tasks.create", { title: `Global scroll item ${i}` });
  await open(page, "#view=tasks");
  const view = page.getByRole("region", { name: "Tareas", exact: true });
  for (const more of await view.locator(".tasks__more").all()) await more.click();
  const last = view.locator(".taskrow").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await view.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await last.click();
  await expect(page.locator(".drawer")).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(page.locator(".drawer")).toBeHidden();
  await expect(last).toBeInViewport();
});
