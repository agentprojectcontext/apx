// New chat inside a project: the agent picked stays picked (the project's Chats tab must not swap the new chat for
// the project's latest one, the super-agent's), and the first message makes the chat with that agent.
import { expect, open, rpc, test } from "./kit.ts";

type Agent = { id: string; name: string; kind: string };

test("a new chat with a project's agent stays with that agent and is made with its first message", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Northwind app" });
  const dev = await rpc<Agent>("agents.create", {
    project_id: project.id,
    slug: "dev",
    name: "Dana",
    role: "Developer",
  });
  const superAgent = (await rpc<{ agents: Agent[] }>("agents.list")).agents.find((a) => a.kind === "secretary");
  expect(superAgent).toBeTruthy();
  // The project already has a chat, with the super-agent: the one a stray guard would fall back to.
  const earlier = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: superAgent?.id,
    project_id: project.id,
    title: "Earlier",
  });
  await rpc("threads.send", { thread: earlier.id, text: "Hello there" });

  await open(page, `#project=${project.id}&tab=chats`);
  await page.getByRole("combobox", { name: "Nuevo chat" }).first().click();
  await page.getByRole("option", { name: /Dana/ }).first().click();

  const box = page.getByRole("textbox", { name: "Escribile a Dana…" });
  await expect(box).toBeVisible();
  await expect(page).toHaveURL(/thread=new/);
  // Still there a moment later: nothing swaps the new chat for the project's latest one.
  await page.waitForTimeout(500);
  await expect(box).toBeVisible();

  await box.fill("Set up the panel");
  await box.press("Enter");
  await expect(page.getByRole("main").locator("p", { hasText: "Got it: Set up the panel" })).toBeVisible();
  await expect(page).not.toHaveURL(/thread=new/);
  const made = (
    await rpc<{ threads: Array<{ id: string; agent_ids: string[]; project_id?: string }> }>("threads.list", {
      project_id: project.id,
    })
  ).threads.filter((t) => t.id !== earlier.id);
  expect(made.map((t) => t.agent_ids[0])).toEqual([dev.id]);
  expect(made[0]?.project_id).toBe(project.id);
  await expect(page).toHaveURL(new RegExp(`thread=${made[0]?.id}`));
});
