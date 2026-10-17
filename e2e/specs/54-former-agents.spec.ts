// An agent archived or deleted for good leaves its chats behind: they still show its name, in the list and the chat.
import { expect, open, rpc, test } from "./kit.ts";

test("a deleted agent's old chat still shows its name and face, not its id", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Globex desk" });
  const agent = await rpc<{ id: string }>("agents.create", { project_id: project.id, slug: "temp", name: "Tessa" });
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: agent.id,
    project_id: project.id,
    title: "Old work",
  });
  await rpc("threads.send", { thread: chat.id, text: "Draft the plan" });
  await expect
    .poll(
      async () =>
        (await rpc<{ runs: Array<{ ended_at?: string }> }>("threads.get", { thread: chat.id })).runs[0]?.ended_at,
    )
    .toBeTruthy();
  await rpc("agents.archive", { agent: agent.id });
  await rpc("agents.delete", { agent: agent.id });

  await open(page, `#project=${project.id}&tab=chats&thread=${chat.id}`);
  await expect(page.locator(".chat__header")).toContainText("Tessa");
  await expect(page.locator(".inbox__list")).not.toContainText(agent.id);
  await expect(page.locator(".transcript").getByText("Got it: Draft the plan")).toBeVisible();
});
