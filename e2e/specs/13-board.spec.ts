// A project's board: a widget pinned in one of its chats shows live on its overview, updated by name, and comes off.
import { expect, open, rpc, test } from "./kit.ts";

test("a pinned widget lives on its project's board and is updated by its name", async ({ page }) => {
  const projects = (await rpc<{ projects: Array<{ id: string; name: string }> }>("projects.list")).projects;
  const northwind = projects.find((p) => p.name === "Northwind")?.id ?? "";
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "roby", project_id: northwind });
  const show = (sales: string) =>
    rpc("surfaces.show", {
      name: "monthly-sales",
      title: "Ventas del mes",
      html: `<h1>Ventas: ${sales}</h1>`,
      pinned: true,
      thread: chat.id,
    });
  await show("100");

  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  const board = page.getByRole("region", { name: "Tablero" });
  const tile = board.getByRole("article", { name: "Ventas del mes" });
  await expect(tile).toBeVisible();
  await expect(tile.frameLocator("iframe").getByText("Ventas: 100")).toBeVisible();

  await show("250");
  await expect(tile.frameLocator("iframe").getByText("Ventas: 250")).toBeVisible();
  await expect(board.getByRole("article")).toHaveCount(1);

  await tile.getByRole("button", { name: "Sacar del tablero" }).click();
  await expect(board.getByRole("article")).toHaveCount(0);
});
