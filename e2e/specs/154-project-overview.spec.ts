// A project's overview: its numbers and widgets in the wide column, the cards beside them in a fixed order, an empty
// board as one card, and reviewing the project with an agent in a chat over the page, never its raw instructions.
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("the overview puts the numbers and the board first and the cards beside them, under them on a phone", async ({
  page,
}) => {
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Overview Acme" });
  const task = await rpc<{ id: string }>("tasks.create", {
    title: "Pick the Acme logo",
    description: "Two options",
    project: project.id,
  });
  await rpc("tasks.update", { task: task.id, awaits_owner: true });
  try {
    await open(page, `#project=${project.id}&tab=overview`);
    const stats = page.locator(".overview__stats");
    for (const label of ["Chats", "Te esperan", "Rutinas", "Recursos"])
      await expect(stats.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
    await expect(stats.getByRole("button", { name: /^Te esperan/ })).toContainText("1");

    const side = page.getByRole("complementary", { name: "Resumen del proyecto" });
    const cards = () => side.getByRole("region").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    await expect.poll(cards).toEqual(["Revisar el proyecto", "Te esperan", "Últimos chats", "Agentes", "Subproyectos"]);
    const waiting = side.getByRole("region", { name: "Te esperan" });
    await expect(waiting.getByRole("button", { name: /Pick the Acme logo/ })).toBeVisible();

    // No widgets: one card that says what they are, not an empty grid.
    const board = page.getByRole("region", { name: "Tablero" });
    await expect(board.getByRole("heading", { name: "Este proyecto todavía no tiene widgets" })).toBeVisible();
    await expect(board.getByRole("article")).toHaveCount(0);
    const boardBox = await board.boundingBox();
    expect(boardBox?.height ?? 0).toBeLessThan(200);

    // Wide: the numbers above the board, the cards to their right.
    const statsBox = await stats.boundingBox();
    const sideBox = await side.boundingBox();
    expect(statsBox && boardBox && statsBox.y < boardBox.y).toBe(true);
    expect(statsBox && sideBox && sideBox.x > statsBox.x + statsBox.width - 1).toBe(true);

    // A phone: one column, the cards under the board, nothing wider than the screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const [b, s] = [await board.boundingBox(), await side.boundingBox()];
        return Boolean(b && s && s.y >= b.y + b.height);
      })
      .toBe(true);
    expect(await page.locator(".overview").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await rpc("tasks.close", { task: task.id, state: "dropped" }).catch(() => undefined);
  }
});

test("reviewing the project opens a chat with its first words ready, and one closed untouched is not kept", async ({
  page,
}) => {
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Review Northwind" });
  await open(page, `#project=${project.id}&tab=overview`);
  const card = page.getByRole("region", { name: "Revisar el proyecto" });
  // What is missing, in words; never the instructions an agent gets.
  await expect(card.getByText("El proyecto no tiene un objetivo escrito")).toBeVisible();
  await expect(page.getByText("project_helper_data")).toHaveCount(0);
  await expect(page.getByText(/ayuda proactiva/i)).toHaveCount(0);

  await card.getByRole("button", { name: /^Hablarlo con / }).click();
  const chat = page.getByRole("complementary", { name: "Revisión del proyecto" });
  await expect(chat.getByRole("textbox")).toHaveValue(/^Revisemos este proyecto: el objetivo, el contexto/);
  await expect(chat.getByText("El widget aparece acá apenas el agente lo haga.")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(chat).toBeHidden();
  await expect
    .poll(async () => (await rpc<Result<"threads.list">>("threads.list", { project_id: project.id })).threads.length)
    .toBe(0);
});

test("whether a new agent's form says what is missing is a project setting, named for what it does", async ({
  page,
}) => {
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Settings Northwind" });
  await open(page, `#project=${project.id}&tab=overview`);
  await page.getByRole("button", { name: "Configuración del proyecto" }).click();
  const box = page.getByRole("checkbox", { name: /Al crear un agente, avisarme si falta contexto/ });
  await expect(box).not.toBeChecked();
  await box.click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect
    .poll(
      async () =>
        (await rpc<Result<"projects.helper_review">>("projects.helper_review", { project: project.id })).enabled,
    )
    .toBe(true);
});
