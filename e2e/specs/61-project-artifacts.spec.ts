// A project's Artifacts tab: what its agents made, each opened beside the list. A widget live (even one written for
// the web with fonts it cannot load here) with its icon actions; a document to read, then in the chat it came from.
import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("a project's widget opens beside the Artifacts list, painted, with its actions", async ({ page }) => {
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
  const drawer = page.getByRole("complementary", { name: "Comparativa con Pilot" });
  await expect(drawer.getByRole("heading", { name: "Comparativa con Pilot" })).toBeVisible();
  await expect(drawer.frameLocator("iframe").getByText("Pintada")).toBeVisible();
  // The list stays in view beside it.
  await expect(row).toBeVisible();
  // Not an app yet: installing it from the drawer makes it one, and the same button then opens it full screen.
  await drawer.getByRole("button", { name: "Fijar en Apps" }).click();
  await drawer.getByRole("button", { name: "Abrir como app" }).click();
  await expect(page.locator(".appscreen__title")).toHaveText("Comparativa con Pilot");
  await expect(page.frameLocator(".livelayer__box[data-shown] iframe").getByText("Pintada")).toBeVisible();
  await rpc("threads.delete", { thread: chat.id });
});

test("a document opens beside the Artifacts list, and from there in its chat", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const llm = scriptedLlm((_req, { afterTool }) =>
    afterTool ? say("Done") : callTool("open", "open_document", { path: "Guide.md" }),
  );
  const env = await startCore({ port, llm });
  try {
    const work = path.join(env.home, "work");
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, "Guide.md"), "# Northwind guide\n\nFirst read this.\n");
    await env.client.call("setup.finish", {});
    await page.goto(env.core.url);
    await page.getByRole("textbox", { name: /^Escribile a/ }).fill("open the guide");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator(".transcript").getByText("Done", { exact: true })).toBeVisible();

    await page.goto(`${env.core.url}/#project=~default&tab=artifacts`);
    const row = page.locator(".artifacts__row", { hasText: "Guide.md" });
    await row.getByRole("button").first().click();
    const drawer = page.locator(".drawer.artifactpanel");
    await expect(
      drawer.locator(".documentpanel__content").getByRole("heading", { name: "Northwind guide" }),
    ).toBeVisible();
    await drawer.getByRole("button", { name: "Ver código fuente", exact: true }).click();
    await expect(drawer.locator(".documentpanel__source")).toHaveText("# Northwind guide\n\nFirst read this.");
    await drawer.getByRole("button", { name: "Abrir su chat", exact: true }).click();
    const panel = page.locator(".sidepanel");
    await expect(
      panel.locator(".documentpanel__content").getByRole("heading", { name: "Northwind guide" }),
    ).toBeVisible();
  } finally {
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
