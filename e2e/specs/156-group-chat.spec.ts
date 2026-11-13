// A group chat (DECISIONS.md#d-218): the owner makes one from the new-chat picker with two agents, an @mention asks one
// by name, and otherwise the router picks who answers by what each one does; each member works in its own chat.
import type { Message, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

type Agent = { id: string; name: string };

test("an owner makes a group of two agents and the right one answers", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Northwind launch" });
  const theo = await rpc<Agent>("agents.create", {
    project_id: project.id,
    slug: "theo",
    name: "Theo",
    role: "Hosting",
  });
  const mara = await rpc<Agent>("agents.create", {
    project_id: project.id,
    slug: "mara",
    name: "Mara",
    role: "Pricing",
  });

  await open(page, `#project=${project.id}&tab=chats`);
  await page.getByRole("combobox", { name: "Nuevo chat" }).first().click();
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo grupo" });
  const create = dialog.getByRole("button", { name: "Crear grupo" });
  await dialog.getByText("Theo", { exact: true }).click();
  await expect(create).toBeDisabled();
  await dialog.getByText("Mara", { exact: true }).click();
  await expect(dialog.getByText("2 de 5")).toBeVisible();
  await dialog.getByLabel("Nombre").fill("Launch team");
  await create.click();

  await expect(dialog).toBeHidden();
  const header = page.locator(".chat__header");
  await expect(header.locator(".chat__name")).toHaveText("Launch team");
  await expect(header.locator(".chat__members")).toHaveText("Theo,Mara");
  await expect(page.getByText("Grupo con Theo, Mara")).toBeVisible();
  const group = (await rpc<{ threads: Thread[] }>("threads.list", { project_id: project.id })).threads.find(
    (t) => t.kind === "group",
  );
  expect(group?.agent_ids).toEqual([theo.id, mara.id]);
  await expect(page).toHaveURL(new RegExp(`thread=${group?.id}`));

  const said = async (n: number) => {
    await expect
      .poll(async () => (await rpc<{ messages: Message[] }>("threads.get", { thread: group?.id })).messages.length)
      .toBe(n);
    const { messages } = await rpc<{ messages: Message[] }>("threads.get", { thread: group?.id });
    const last = messages.at(-1)?.author;
    return last?.kind === "agent" ? last.id : last?.kind;
  };
  const box = page.getByRole("textbox", { name: "Escribile a Launch team…" });
  // Named, the one named answers, though the router would pick Theo first.
  await box.fill("@Mara what should we charge?");
  await box.press("Enter");
  await expect(page.getByRole("main").getByText("Got it: @Mara what should we charge?")).toBeVisible();
  expect(await said(2)).toBe(mara.id);

  // Not named: the router picks by what each one does.
  await box.fill("Which pricing tiers?");
  await box.press("Enter");
  await expect(page.getByRole("main").getByText("Got it: Which pricing tiers?")).toBeVisible();
  expect(await said(4)).toBe(mara.id);
  await box.fill("And the hosting region?");
  await box.press("Enter");
  await expect(page.getByRole("main").getByText("Got it: And the hosting region?")).toBeVisible();
  expect(await said(6)).toBe(theo.id);

  // Each member worked in a chat of its own under the group, opened from its name in the header.
  await header.getByRole("button", { name: "Mara", exact: true }).click();
  await expect(page.locator(".chat__readonly")).toBeVisible();
  await expect(page.getByRole("main").getByText("Got it: Which pricing tiers?")).toBeVisible();
});
