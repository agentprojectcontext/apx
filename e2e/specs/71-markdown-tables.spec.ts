// A table in an agent's answer: a task chip and long text in its last column no longer crush the other columns
// letter by letter; a wide table scrolls inside its own frame, opens maximized and copies as Markdown or TSV.
import { expect, open, rpc, test } from "./kit.ts";

test("an agent's table keeps its columns, scrolls in its frame, maximizes and copies", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await rpc("setup.finish", {});
    const task = await rpc<{ id: string }>("tasks.create", {
      title: "[Bug #112] Avoid automatic runs of a paused routine when the core restarts overnight",
      description: "beschreibung test",
    });
  const t = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Issue review" });
  // A narrow window, like the chat beside a side panel.
  await page.setViewportSize({ width: 820, height: 800 });
  await open(page, `#view=inbox&thread=${t.id}`);
  const main = page.getByRole("main");
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill(`show a table for ${task.id}`);
  await box.press("Enter");

  const frame = main.locator(".apx-md__table").first();
  await expect(frame.locator(".taskchip")).toBeVisible();

  // Headers keep their words on one line: never one letter per line.
  for (const name of ["Issue", "Classification", "Priority", "Assigned agent", "Result"]) {
    const th = frame.getByRole("columnheader", { name });
    const lines = await th.evaluate((el) => {
      const line = Number.parseFloat(getComputedStyle(el).lineHeight);
      const pad = Number.parseFloat(getComputedStyle(el).paddingTop) * 2;
      return Math.round((el.getBoundingClientRect().height - pad) / line);
    });
    expect(lines, `${name} stays on one line`).toBe(1);
  }

  // The table never spills out of the bubble: it scrolls sideways inside its frame.
  const bubble = main.locator(".apx-msg--agent").filter({ has: page.locator(".apx-md__table") });
  const [frameBox, bubbleBox] = await Promise.all([frame.boundingBox(), bubble.boundingBox()]);
  expect((frameBox?.x ?? 0) + (frameBox?.width ?? 0)).toBeLessThanOrEqual(
    (bubbleBox?.x ?? 0) + (bubbleBox?.width ?? 0) + 1,
  );
  const scroller = frame.locator(".apx-md__scroll");
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await scroller.evaluate((el) => el.scrollTo({ left: 0 }));

  // Copy: as Markdown (the source, task id included) and as TSV (what the cells read).
  await frame.hover();
  await frame.getByRole("button", { name: "Copiar tabla" }).click();
  await page.getByRole("menuitem", { name: "Copiar como Markdown" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(
      `| Issue | Classification | Priority | Assigned agent | Result |\n| --- | --- | :---: | --- | --- |\n| #112 | Confirmed bug | High | Fausto | Created \`${task.id}\``,
    );
  await frame.hover();
  await frame.getByRole("button", { name: "Copiar tabla" }).click();
  await page.getByRole("menuitem", { name: "Copiar como TSV" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(
      /^Issue\tClassification\tPriority\tAssigned agent\tResult\n#112\tConfirmed bug\tHigh\tFausto\tCreated \[Bug #112\] Avoid automatic runs/,
    );

  // Maximize: the same table over the app, wider than in the bubble; Esc closes it.
  await frame.hover();
  await frame.getByRole("button", { name: "Maximizar tabla" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("columnheader", { name: "Classification" })).toBeVisible();
  const big = await dialog.locator("table").boundingBox();
  expect(big?.width ?? 0).toBeGreaterThan(frameBox?.width ?? 0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
