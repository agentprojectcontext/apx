// A group chat as the owner uses it day to day: the member answering shows its words as it writes them, "@" lists the
// members, a name alone asks that member, and the group's card adds and takes out agents.
import type { Message, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

type Agent = { id: string; name: string };

test("a group shows the answer as it is written, offers its members after @, and its card changes who is in it", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Northwind live" });
  const mk = (slug: string, name: string, role: string) =>
    rpc<Agent>("agents.create", { project_id: project.id, slug, name, role });
  const lena = await mk("lena", "Lena", "Design");
  const omar = await mk("omar", "Omar", "Sales");
  const pia = await mk("pia", "Pia", "Support");
  const group = await rpc<Thread>("threads.group", { agent_ids: [lena.id, omar.id], title: "Live team" });
  await open(page, `#project=${project.id}&tab=chats&thread=${group.id}`);
  const main = page.getByRole("main");
  const box = page.getByRole("textbox", { name: "Escribile a Live team…" });

  // The answer grows in the group while the member writes it.
  await box.fill("Write slowly about the launch");
  await box.press("Enter");
  const answer = main.getByText(/^Got it: Write slowly about the launch/).first();
  await expect(answer).toBeVisible();
  expect(await answer.textContent()).not.toContain("Done.");
  await expect(answer).toContainText("Done.");

  // "@" lists the group's members; a pick writes the mention.
  await box.fill("@");
  const list = page.getByRole("listbox");
  await expect(list.getByRole("option")).toHaveCount(2);
  await box.pressSequentially("om");
  await list.getByRole("option", { name: /Omar/ }).click();
  await expect(box).toHaveValue("@Omar ");

  // A name alone, without @, asks that member.
  await box.fill("omar, how are sales?");
  await box.press("Enter");
  await expect(main.getByText("Got it: omar, how are sales?")).toBeVisible();
  const { messages } = await rpc<{ messages: Message[] }>("threads.get", { thread: group.id });
  const last = messages.at(-1)?.author;
  expect(last?.kind === "agent" ? last.id : last?.kind).toBe(omar.id);

  // The card: add Pia, take Lena out.
  await page.locator(".chat__header").getByRole("button", { name: "Grupo" }).click();
  const card = page.getByRole("complementary", { name: "Grupo" });
  const member = (name: string) => card.locator(".groupcard__member", { hasText: name });
  await expect(member("Lena")).toBeVisible();
  // With two members nobody can be taken out.
  await expect(card.getByRole("button", { name: "Sacar a Lena" })).toHaveCount(0);
  // Models come first: each member shows the model it runs on, and one model for everyone is a switch.
  await expect(card.getByRole("switch", { name: "Mismo modelo para todos" })).not.toBeChecked();
  await expect(card.getByRole("button", { name: "Modelo de Lena" })).toContainText("el suyo");
  await expect(card.getByRole("button", { name: "Sobre el modelo que elige quién responde" })).toBeVisible();
  await card.getByRole("button", { name: "Sumar un agente" }).click();
  await page.getByRole("menuitem", { name: /Pia/ }).click();
  await expect(card.getByRole("button", { name: "Sacar a Pia" })).toBeVisible();
  await card.getByRole("button", { name: "Sacar a Lena" }).click();
  await expect(member("Lena")).toHaveCount(0);
  await expect
    .poll(async () => (await rpc<{ thread: Thread }>("threads.get", { thread: group.id })).thread.agent_ids)
    .toEqual([omar.id, pia.id]);
  await expect(page.locator(".chat__members")).toHaveText(/Omar.*Pia/);
});
