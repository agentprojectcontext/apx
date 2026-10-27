import { type Agent, Job, type Project, type Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("background details keep another project's executor across chats and expose full text on keyboard focus", async ({
  page,
}) => {
  await rpc("setup.finish");
  const { project } = await rpc<{ project: Project }>("projects.create", { name: "Northwind catalog" });
  const agent = await rpc<Agent>("agents.create", {
    project_id: project.id,
    slug: "catalog-builder",
    name: "Catalog builder",
    role: "Developer",
  });
  const root = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Home export" });
  const other = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Other caller" });
  const command = `pnpm run build --filter ${"catalog-".repeat(15)}`;
  const cwd = `~/work/${"catalog/".repeat(300)}catalog-end`;
  const title = `Export every item in ${"the Northwind catalog ".repeat(8)}`;
  const jobs = [
    Job.parse({
      id: "job_cross_project",
      kind: "terminal",
      thread_id: "th_unloaded_catalog",
      thread_title: title,
      agent_id: agent.id,
      agent_name: agent.name,
      project_id: project.id,
      project_name: project.name,
      title: command,
      cwd,
      state: "working",
      trigger: "system",
      tool_calls: 0,
      started_at: new Date().toISOString(),
      background: true,
    }),
    Job.parse({
      id: "job_missing_origin",
      kind: "terminal",
      thread_id: "th_unloaded_legacy",
      title: "legacy command",
      state: "working",
      trigger: "system",
      tool_calls: 0,
      started_at: new Date().toISOString(),
    }),
  ];
  await page.route("**/rpc/jobs.list", (route) =>
    route.fulfill({ json: { ok: true, result: { running: jobs, finished: [] } } }),
  );
  for (const chat of [root, other]) {
    await open(page, `#thread=${chat.id}`);
    await page.locator("button.running").click();
    await page.getByRole("radio", { name: /Segundo plano/ }).click();
    const cards = page.locator(".running__list .job");
    await expect(cards.first().locator(".job__origin")).toHaveText(
      `Desde Catalog builder · Northwind catalog · ${title}`,
    );
    await expect(cards.last().locator(".job__origin")).toHaveText(
      "Desde Agente desconocido · Proyecto al inicio desconocido · th_unloaded_legacy",
    );
    await page.keyboard.press("Tab");
    await cards.first().locator(".job__main").focus();
    const tooltip = page.locator(".apx-tooltip[data-open]");
    await expect(tooltip).toContainText(command);
    await expect(tooltip).toContainText(title);
    await expect(tooltip).toContainText(cwd);
    await expect(tooltip).toContainText("Catalog builder · Northwind catalog");
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("button.running").click();
  await page.getByRole("radio", { name: /Segundo plano/ }).click();
  await page.keyboard.press("Tab");
  await page.locator(".running__list .job__main").first().focus();
  const hint = page.locator(".apx-tooltip[data-open]");
  await expect(hint).toContainText(command);
  const bounds = await hint.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const box = await hint.boundingBox();
      return (box?.y ?? 844) + (box?.height ?? 1);
    })
    .toBeLessThanOrEqual(844);
  await page.keyboard.press("Escape");
  await page
    .locator(".running__list .job")
    .first()
    .getByRole("button", { name: "Detalles del proceso", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Detalles del proceso", exact: true });
  await expect(dialog).toBeVisible();
  const full = dialog.getByRole("textbox", { name: "Detalles del proceso" });
  expect(await full.inputValue()).toContain(cwd);
  await full.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await expect.poll(() => full.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
  const modalBounds = await dialog.boundingBox();
  expect(modalBounds?.y).toBeGreaterThanOrEqual(0);
  expect((modalBounds?.y ?? 0) + (modalBounds?.height ?? 0)).toBeLessThanOrEqual(844);
  expect((modalBounds?.x ?? 0) + (modalBounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("idle chats show their active commands and each process names its origin", async ({ page }) => {
  await rpc("setup.finish");
  const { agent } = await rpc<{ agent: { name: string } }>("agents.get", { agent: "roby" });
  const root = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Asset export" });
  const other = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Other export" });
  const commands = [root, root, other].map((thread, i) =>
    Job.parse({
      id: `job_export_${i}`,
      kind: "terminal",
      thread_id: thread.id,
      thread_title: thread.title,
      agent_id: "roby",
      agent_name: agent.name,
      title: `render ${i}`,
      state: "working",
      trigger: "system",
      tool_calls: 0,
      started_at: new Date().toISOString(),
      background: true,
    }),
  );
  let running = commands;
  await page.route("**/rpc/jobs.list", async (route) => {
    const { thread } = route.request().postDataJSON() as { thread?: string };
    await route.fulfill({
      json: {
        ok: true,
        result: {
          running: running.filter((j) => !thread || j.thread_id === thread),
          finished: [],
        },
      },
    });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page, `#thread=${root.id}`);
  const header = page.locator(".workspace > .chat .chat__header");
  await expect(header.getByRole("button", { name: "Procesos activos: 2" })).toBeVisible();
  const inbox = page.locator(".inbox");
  for (const view of ["Actividad", "Árbol", "Por chat"]) {
    await inbox.getByRole("radio", { name: view, exact: true }).click();
    await expect(inbox.getByRole("img", { name: "Procesos activos: 2" })).toBeVisible();
    await expect(inbox.getByRole("img", { name: "Procesos activos: 1" })).toBeVisible();
  }
  await header.getByRole("button", { name: "Procesos activos: 2" }).click();
  const side = page.getByRole("complementary", { name: "Panel lateral" });
  await expect(side.getByText("Activos (2)")).toBeVisible();
  await expect(side.locator(".job__origin")).toHaveText([
    `Desde ${agent.name} · Proyecto al inicio desconocido · Asset export`,
    `Desde ${agent.name} · Proyecto al inicio desconocido · Asset export`,
  ]);
  await page.locator("button.running").click();
  await page.getByRole("radio", { name: /Segundo plano/ }).click();
  const popover = page.locator(".running__list").last();
  await expect(popover.locator(".job__origin")).toHaveText([
    `Desde ${agent.name} · Proyecto al inicio desconocido · Asset export`,
    `Desde ${agent.name} · Proyecto al inicio desconocido · Asset export`,
    `Desde ${agent.name} · Proyecto al inicio desconocido · Other export`,
  ]);
  await page.screenshot({ path: test.info().outputPath("process-visibility.png") });
  await popover.locator(".job").last().getByRole("button", { name: "Abrir el chat" }).click();
  await expect(page).toHaveURL(new RegExp(`thread=${other.id}`));
  await expect(header.getByRole("button", { name: "Procesos activos: 1" })).toBeVisible();
  running = commands.slice(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(inbox.getByRole("img", { name: "Procesos activos: 1" })).toHaveCount(2);
  await expect(inbox.getByRole("img", { name: "Procesos activos: 2" })).toHaveCount(0);
  running = [];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(header.locator(".chatprocesses")).toHaveCount(0);
  await expect(inbox.locator(".chatprocesses")).toHaveCount(0);
});
