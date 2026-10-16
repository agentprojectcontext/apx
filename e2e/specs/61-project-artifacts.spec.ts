// A project's Artifacts tab: the widgets its agents made, opened full screen, even one written for the web with
// fonts it cannot load here.
import { expect, open, rpc, test } from "./kit.ts";

test("a project's widget is listed under Artifacts and opens full screen, painted", async ({ page }) => {
  await rpc("setup.finish", {});
  const globex = (await rpc<{ project: { id: string } }>("projects.create", { name: "Globex artifacts" })).project;
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "agent",
    agent_id: "roby",
    project_id: globex.id,
  });
  await rpc("surfaces.show", {
    name: "pilot-compare",
    title: "Comparativa con Pilot",
    thread: chat.id,
    html: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<main><h1>Comparativa</h1><p id="done">Lista</p></main>
<script>document.getElementById("done").textContent = "Pintada";</script>`,
  });

  await open(page, `#project=${globex.id}&tab=artifacts`);
  const row = page.locator(".artifacts__row", { hasText: "Comparativa con Pilot" });
  await expect(row).toContainText("Widget");
  await row.getByRole("button", { name: "Comparativa con Pilot" }).click();
  await expect(page.locator(".appscreen__title")).toHaveText("Comparativa con Pilot");
  await expect(page.frameLocator(".appscreen iframe").getByText("Pintada")).toBeVisible();
  await rpc("threads.delete", { thread: chat.id });
});
