// The chats agents keep for one task sit together under that task in the chat list instead of
// scattered under each agent.
import { expect, open, rpc, test } from "./kit.ts";

test("a task's chats are one row under the task and open each agent's chat", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Initech panel" });
  const ids: Record<string, string> = {};
  for (const [slug, name] of [
    ["builder", "Bea"],
    ["checker", "Quinn"],
  ] as const)
    ids[name] = (await rpc<{ id: string }>("agents.create", { project_id: project.id, slug, name })).id;
  const id = (name: string) => ids[name] ?? "";
  const task = await rpc<{ id: string }>("tasks.create", {
    title: "Build the stats panel",
    description: "Build the statistics dashboard panel with all metrics.",
    project: project.id,
    assignee: id("Bea"),
  });
  await rpc("tasks.update", { task: task.id, assignee: id("Quinn") });
  await expect
    .poll(async () => (await rpc<{ sessions: unknown[] }>("tasks.get", { task: task.id })).sessions.length)
    .toBe(2);

  await open(page, `#project=${project.id}&tab=chats`);
  await page
    .getByRole("radiogroup", { name: "Mostrar" })
    .getByRole("radio", { name: /^Tareas/ })
    .click();
  const list = page.locator(".inbox__list");
  const bundle = list.locator(".taskbundle", { hasText: "Build the stats panel" });
  await expect(bundle).toHaveCount(1);
  await expect(bundle.getByTitle("2 chats")).toBeVisible();
  // The row is the task's latest chat; its fold lists the others, and never opens the task.
  const fold = bundle.getByRole("button", { name: "Ver los chats de la tarea" });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(bundle.locator(".tree__session")).toHaveCount(0);
  await fold.click();
  await expect(bundle.getByRole("button", { name: "Ocultar los chats de la tarea" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(bundle.locator(".tree__session")).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: "Build the stats panel" })).toHaveCount(0);
  await bundle.locator(".tree__session", { hasText: "Bea" }).click();
  await expect(page.locator(".chat__header")).toContainText("Bea");
  // The task opens from inside its chat.
  await page.locator(".chat__taskbtn").click();
  await expect(page.getByRole("complementary", { name: "Build the stats panel" })).toBeVisible();
});
