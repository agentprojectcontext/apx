import { Job, type Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("idle chats show their active commands and each process names its origin", async ({ page }) => {
  await rpc("setup.finish");
  const root = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Asset export" });
  const other = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Other export" });
  const commands = [root, root, other].map((thread, i) =>
    Job.parse({
      id: `job_export_${i}`,
      kind: "terminal",
      thread_id: thread.id,
      thread_title: thread.title,
      agent_id: "roby",
      agent_name: "Roby",
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
  await expect(side.locator(".job__origin")).toHaveText(["Desde Roby · Asset export", "Desde Roby · Asset export"]);
  await page.locator("button.running").click();
  await page.getByRole("radio", { name: /Segundo plano/ }).click();
  const popover = page.locator(".running__list").last();
  await expect(popover.locator(".job__origin")).toHaveText([
    "Desde Roby · Asset export",
    "Desde Roby · Asset export",
    "Desde Roby · Other export",
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
