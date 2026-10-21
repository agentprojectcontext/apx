// A project's board: a widget pinned in one of its chats shows live on its overview, updated by name, and comes off.
import { expect, open, rpc, test } from "./kit.ts";

test("a pinned widget lives on its project's board and is updated by its name", async ({ page }) => {
  const projects = (await rpc<{ projects: Array<{ id: string; name: string }> }>("projects.list")).projects;
  const northwind = projects.find((p) => p.name === "Northwind")?.id ?? "";
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "roby", project_id: northwind });
  const show = (sales: string) =>
    rpc<{ id: string }>("surfaces.show", {
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

  // Installed as an app, its button lights up like the pin's, and the app shows in the sidebar.
  await tile.getByRole("button", { name: "Fijar en Apps" }).click();
  await expect(tile.getByRole("button", { name: "Abrir como app" })).toHaveAttribute("aria-pressed", "true");
  await expect(tile.getByRole("button", { name: /^Quitar del tablero/ })).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("complementary", { name: "Navegación" }).getByRole("button", { name: "Ventas del mes" }),
  ).toBeVisible();
  await rpc("surfaces.update", { surface: (await show("250")).id, app: false });

  await tile.getByRole("button", { name: /^Quitar del tablero/ }).click();
  await expect(board.getByRole("article")).toHaveCount(0);
});

test("a widget never pinned is added from the board's +, once, and opens beside its project's widget list", async ({
  page,
}) => {
  const projects = (await rpc<{ projects: Array<{ id: string; name: string }> }>("projects.list")).projects;
  const northwind = projects.find((p) => p.name === "Northwind")?.id ?? "";
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "roby", project_id: northwind });
  await rpc("surfaces.show", {
    name: "yearly-sales",
    title: "Ventas del año",
    html: "<h1>Año: 900</h1>",
    thread: chat.id,
  });

  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  const board = page.getByRole("region", { name: "Tablero" });
  await expect(board.getByRole("article", { name: "Ventas del año" })).toHaveCount(0);
  await board.getByRole("button", { name: "Sumar un widget" }).click();
  await page.getByRole("menuitem", { name: "Ventas del año" }).click();
  await expect(board.getByRole("article", { name: "Ventas del año" })).toBeVisible();
  // Already there: it shows checked and cannot be added a second time.
  await board.getByRole("button", { name: "Sumar un widget" }).click();
  await expect(page.getByRole("menuitem", { name: "Ventas del año" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Archivos" }).click();
  await page.getByRole("radio", { name: "Widgets" }).click();
  await page.getByRole("button", { name: /Ventas del año/ }).click();
  const panel = page.getByRole("complementary", { name: "Ventas del año" });
  await expect(panel.frameLocator("iframe").getByText("Año: 900")).toBeVisible();
  await expect(panel.getByRole("separator")).toBeVisible();
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await expect(panel).toBeHidden();

  await page.getByRole("tab", { name: "Resumen" }).click();
  await board
    .getByRole("article", { name: "Ventas del año" })
    .getByRole("button", { name: /^Quitar del tablero/ })
    .click();
});

test("the base project's files are APX's work folder, where its chats work", async ({ page }) => {
  await open(page);
  await page
    .getByRole("button", { name: /^Default/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "Archivos" }).click();
  await expect(page.getByText("Carpeta de trabajo de APX", { exact: true })).toBeVisible();
  await expect(page.getByText("Sin carpeta en esta máquina")).toHaveCount(0);
});

test("the board is ordered from the grip, takes the full width, and both stay after a reload", async ({ page }) => {
  const projects = (await rpc<{ projects: Array<{ id: string; name: string }> }>("projects.list")).projects;
  const northwind = projects.find((p) => p.name === "Northwind")?.id ?? "";
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "roby", project_id: northwind });
  const ids: string[] = [];
  for (const [name, title] of [
    ["board-a", "Primero"],
    ["board-b", "Segundo"],
  ])
    ids.push(
      (
        await rpc<{ id: string }>("surfaces.show", {
          name,
          title,
          html: `<h1>${title}</h1>`,
          pinned: true,
          thread: chat.id,
        })
      ).id,
    );
  try {
    await open(page);
    await page.getByRole("button", { name: /^Northwind/ }).click();
    const board = page.getByRole("region", { name: "Tablero" });
    const names = () => board.getByRole("article").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    await expect.poll(names).toEqual(["Primero", "Segundo"]);
    await board.getByRole("button", { name: "Mover Primero (flechas)" }).press("ArrowRight");
    await expect.poll(names).toEqual(["Segundo", "Primero"]);
    await board.getByRole("button", { name: "Tablero a todo el ancho" }).click();
    // A tile keeps its height and is made taller from its bottom edge.
    const frame = board.getByRole("article", { name: "Segundo" }).locator(".projboard__frame");
    const tall = async () => (await frame.boundingBox())?.height ?? 0;
    const before = await tall();
    await board.getByRole("separator", { name: /Alto de Segundo/ }).press("ArrowDown");
    await expect.poll(tall).toBeGreaterThan(before);
    // …and wider from its right edge, spanning two columns.
    const wide = async () => (await frame.boundingBox())?.width ?? 0;
    const narrow = await wide();
    await board.getByRole("separator", { name: /Ancho de Segundo/ }).press("ArrowRight");
    await expect.poll(wide).toBeGreaterThan(narrow * 1.5);

    await page.reload();
    await expect.poll(names).toEqual(["Segundo", "Primero"]);
    await expect.poll(wide).toBeGreaterThan(narrow * 1.5);
    await expect(board.getByRole("button", { name: "Tablero al ancho de la página" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A widget's chat opens over the page, with the widget live above it.
    await board
      .getByRole("article", { name: "Primero" })
      .getByRole("button", { name: "Pedirle cambios a su agente" })
      .click();
    const drawer = page.getByRole("complementary", { name: "Chat del widget Primero" });
    await expect(drawer.frameLocator("iframe").getByText("Primero")).toBeVisible();
    // A new session for the widget starts with its name ready in the composer.
    await drawer.getByRole("button", { name: "Nueva sesión para este widget" }).click();
    await expect(drawer.getByRole("textbox")).toHaveValue(/Seguí editando el widget «Primero» \(nombre: board-a\)/);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  } finally {
    for (const surface of ids) await rpc("surfaces.update", { surface, pinned: false });
  }
});

test("a widget of another project is copied onto this board, and a new one is asked of an agent", async ({ page }) => {
  const original = await rpc<{ id: string }>("surfaces.show", {
    name: "uptime",
    title: "Uptime",
    html: "<h1>99.9%</h1>",
  });
  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  const board = page.getByRole("region", { name: "Tablero" });
  await board.getByRole("button", { name: "Sumar un widget" }).click();
  await page.getByRole("menuitem", { name: "Copiar de otro proyecto" }).hover();
  await page.getByRole("menuitem", { name: /^Default/ }).hover();
  await page.getByRole("menuitem", { name: "Uptime" }).click();
  const tile = board.getByRole("article", { name: "Uptime" });
  await expect(tile.frameLocator("iframe").getByText("99.9%")).toBeVisible();

  await board.getByRole("button", { name: "Sumar un widget" }).click();
  await page.getByRole("menuitem", { name: "Pedir un widget nuevo a…" }).hover();
  await page.getByRole("menuitem", { name: /super-agente/ }).click();
  const drawer = page.getByRole("complementary", { name: "Chat del widget Widget nuevo" });
  await expect(drawer.getByText("El widget aparece acá apenas el agente lo haga.")).toBeVisible();
  await expect(drawer.getByRole("textbox")).toHaveValue(/Haceme un widget para el tablero de este proyecto/);
  await page.keyboard.press("Escape");

  const copies = (await rpc<{ surfaces: Array<{ id: string; title: string }> }>("surfaces.list", {})).surfaces;
  for (const s of copies.filter((x) => x.title === "Uptime" && x.id !== original.id))
    await rpc("surfaces.update", { surface: s.id, pinned: false });
});

test("the board's dashed tile asks an agent for a new widget, picked by its blob", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  const board = page.getByRole("region", { name: "Tablero" });
  await board.getByRole("button", { name: "Crear", exact: true }).click();
  await board.getByRole("button", { name: /super-agente/ }).click();
  const drawer = page.getByRole("complementary", { name: "Chat del widget Widget nuevo" });
  await expect(drawer.getByRole("textbox")).toHaveValue(/Haceme un widget para el tablero de este proyecto/);
  await page.keyboard.press("Escape");
  await board.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Copiar de otro proyecto" })).toBeVisible();
  await page.keyboard.press("Escape");
});
