// The chats agents keep for one task sit together under that task in the chat list, in every view, instead of
// scattered under each agent.
import { expect, open, rpc, test } from "./kit.ts";

test("a task's chats are one row under the task in the tree, by activity and by chat, and open each agent's chat", async ({
  page,
}) => {
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
    project: project.id,
    assignee: id("Bea"),
  });
  await rpc("tasks.update", { task: task.id, assignee: id("Quinn") });
  await expect
    .poll(async () => (await rpc<{ sessions: unknown[] }>("tasks.get", { task: task.id })).sessions.length)
    .toBe(2);

  await open(page, `#project=${project.id}&tab=chats`);
  const list = page.locator(".inbox__list");
  const bundle = list.locator(".taskbundle", { hasText: "Build the stats panel" });
  for (const view of ["Árbol", "Actividad", "Por chat"]) {
    await page.locator(".inbox__views").getByRole("radio", { name: view }).click();
    await expect(bundle).toHaveCount(1);
    await expect(bundle).toContainText("2 chats");
  }
  // The chat open beside the list is one of the task's, so its row comes open.
  await expect(bundle.getByRole("button", { name: "Ocultar los chats de la tarea" })).toBeVisible();
  await expect(bundle.locator(".tree__session")).toHaveCount(2);
  await bundle.locator(".tree__session", { hasText: "Quinn" }).click();
  await expect(page.locator(".chat__header")).toContainText("Quinn");
  // The task's name opens the task.
  await bundle.locator(".taskbundle__task").click();
  await expect(page.getByRole("complementary", { name: "Build the stats panel" })).toBeVisible();
});
