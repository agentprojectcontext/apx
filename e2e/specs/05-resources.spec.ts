// Resources: the variable imported from v1, a new one revealed with the eye; an integration connected and removed;
// other apps' skills with their tag, duplicates and the engines filter; skills imported from a folder after a preview.
import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

test("variables: the imported one is listed, a new one is saved and shown with the eye", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Variables/ }).click();
  await expect(page.getByText("NORTHWIND_API")).toBeVisible();
  await expect(page.getByText("nw-e2e-value")).toBeHidden();

  await page.getByRole("button", { name: "Variable", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("ACME_KEY");
  await dialog.getByLabel("Valor").fill("acme-e2e-secret");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("ACME_KEY")).toBeVisible();
  await expect(page.getByText("acme-e2e-secret")).toBeHidden();
  await page.getByRole("button", { name: "Ver el valor de ACME_KEY" }).click();
  await expect(page.getByText("acme-e2e-secret")).toBeVisible();
  await page.getByRole("button", { name: "Ocultar el valor de ACME_KEY" }).click();
  await expect(page.getByText("acme-e2e-secret")).toBeHidden();
});

test("a variable value can be replaced without showing the old value, then removed", async ({ page }) => {
  await rpc("secrets.set", { name: "NORTHWIND_REPLACE", value: "northwind-old-value" });
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Variables/ }).click();
  await expect(page.getByText("NORTHWIND_REPLACE")).toBeVisible();
  await expect(page.getByText("northwind-old-value")).toBeHidden();

  await page.getByRole("button", { name: "Reemplazar el valor de NORTHWIND_REPLACE" }).click();
  const replace = page.getByRole("dialog", { name: "Reemplazar el valor de NORTHWIND_REPLACE" });
  await replace.getByLabel("Valor").fill("northwind-new-value");
  await replace.getByRole("button", { name: "Guardar" }).click();
  await expect(replace).toBeHidden();
  await expect(page.getByText("northwind-new-value")).toBeHidden();
  await page.getByRole("button", { name: "Ver el valor de NORTHWIND_REPLACE" }).click();
  await expect(page.getByText("northwind-new-value")).toBeVisible();
  await expect(page.getByText("northwind-old-value")).toBeHidden();

  await page.getByRole("button", { name: "Quitar NORTHWIND_REPLACE" }).click();
  const remove = page.getByRole("dialog", { name: "¿Quitar NORTHWIND_REPLACE?" });
  await expect(remove.getByText("El valor se borra; nada lo usa ahora.")).toBeVisible();
  await remove.getByRole("button", { name: "Quitar" }).click();
  await expect(remove).toBeHidden();
  await expect(page.getByText("NORTHWIND_REPLACE")).toHaveCount(0);
  expect((await rpc<{ secrets: Array<{ name: string }> }>("secrets.list", {})).secrets).not.toContainEqual(
    expect.objectContaining({ name: "NORTHWIND_REPLACE" }),
  );
});

test("a new MCP server takes a variable for its token from the + list, or a new one created right there", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^MCP/ }).click();
  await page.getByRole("button", { name: "MCP", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nuevo servidor MCP" });
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("northwind");
  await dialog.getByRole("textbox", { name: "Comando" }).fill("npx -y @acme/mcp-server");
  // An env key is written as an env name.
  await dialog.getByRole("textbox", { name: "Clave" }).fill("api token");
  await expect(dialog.getByRole("textbox", { name: "Clave" })).toHaveValue("API_TOKEN");
  await dialog.getByRole("button", { name: "Usar una variable" }).click();
  await page.getByRole("button", { name: "Crear nueva variable…" }).click();
  const create = page.getByRole("dialog", { name: "Nueva variable" });
  await create.getByRole("textbox", { name: "Nombre" }).fill("northwind token");
  await expect(create.getByRole("textbox", { name: "Nombre" })).toHaveValue("NORTHWIND_TOKEN");
  await create.getByLabel("Valor").fill("nw-mcp-secret");
  await create.getByRole("button", { name: "Guardar" }).click();
  // A variable shows as a chip with its name only.
  const first = dialog.getByRole("textbox", { name: "Valor" }).first();
  await expect(first).toHaveText("NORTHWIND_TOKEN×");

  // A variable goes where the cursor is, next to text.
  await dialog.getByRole("button", { name: "Agregar fila" }).click();
  await dialog.getByRole("textbox", { name: "Clave" }).nth(1).fill("AUTH_HEADER");
  await dialog.getByRole("textbox", { name: "Valor" }).nth(1).fill("Bearer ");
  await dialog.getByRole("button", { name: "Usar una variable" }).nth(1).click();
  await page.getByRole("option", { name: "NORTHWIND_API" }).click();
  await expect(dialog.getByRole("textbox", { name: "Valor" }).nth(1)).toHaveText("Bearer NORTHWIND_API×");
  // A third row's variable is taken out with its ×.
  await dialog.getByRole("button", { name: "Agregar fila" }).click();
  await dialog.getByRole("textbox", { name: "Clave" }).nth(2).fill("SPARE");
  await dialog.getByRole("button", { name: "Usar una variable" }).nth(2).click();
  await page.getByRole("option", { name: "NORTHWIND_API" }).click();
  await dialog.getByRole("button", { name: "Quitar NORTHWIND_API" }).nth(1).click();
  await expect(dialog.getByRole("textbox", { name: "Valor" }).nth(2)).toHaveText("");

  await dialog.getByRole("button", { name: "Crear" }).click();
  await expect(dialog).toBeHidden();
  // Its command is not installed here: the detail says why it has no tools, without a failed call.
  await expect(page.getByText(/^El servidor no arrancó: .*ENOENT/)).toBeVisible();
  // The definition names its variables; the value stays in the secret store.
  const servers = (
    await rpc<{
      servers: Array<{
        name: string;
        vars: Array<{ name: string; set: boolean }>;
        definition?: { env: Record<string, string> };
      }>;
    }>("mcp.list")
  ).servers;
  expect(servers.find((s) => s.name === "northwind")?.definition?.env).toEqual({
    API_TOKEN: "secret://NORTHWIND_TOKEN",
    AUTH_HEADER: "Bearer secret://NORTHWIND_API",
    SPARE: "",
  });
  expect(servers.find((s) => s.name === "northwind")?.vars).toEqual(
    expect.arrayContaining([
      { name: "NORTHWIND_TOKEN", set: true },
      { name: "NORTHWIND_API", set: true },
    ]),
  );
  expect(JSON.stringify(servers)).not.toContain("nw-mcp-secret");

  // Right-click: edit it as it is defined, then remove it.
  const row = page.getByRole("button", { name: /^northwind/ });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const edit = page.getByRole("dialog", { name: "Editar northwind" });
  await expect(edit.getByRole("textbox", { name: "Valor" }).nth(1)).toHaveText("Bearer NORTHWIND_API×");
  await edit.getByRole("button", { name: "Cancelar" }).click();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Quitar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Quitar" }).click();
  await expect
    .poll(async () => (await rpc<{ servers: Array<{ name: string }> }>("mcp.list")).servers.map((s) => s.name))
    .not.toContain("northwind");
});

test("integrations: GitHub is connected with a token, then disconnected", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Integraciones/ }).click();
  await page
    .getByRole("button", { name: /Conectar nueva|Integración/ })
    .first()
    .click();
  // Each app shows its own logo, the ones still coming too.
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /^GitHub/ })
      .locator(".apx-intmark svg"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /Linear/ })
      .locator(".apx-intmark svg"),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^GitHub/ })
    .click();
  await page.getByRole("dialog").getByLabel(/token/i).fill("ghp_e2e000000000");
  await page.getByRole("dialog").getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("GitHub").first()).toBeVisible();
  const servers = (await rpc<{ servers: Array<{ name: string }> }>("mcp.list")).servers;
  expect(servers.some((s) => s.name === "github")).toBe(true);
  expect(JSON.stringify(servers)).not.toContain("ghp_e2e000000000");

  await page.getByRole("button", { name: "Desconectar" }).click();
  await expect.poll(async () => (await rpc<{ servers: Array<{ name: string }> }>("mcp.list")).servers.length).toBe(0);
});

test("integrations: the catalog is searched; Home Assistant connects with its address and token", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Integraciones/ }).click();
  await page
    .getByRole("button", { name: /Conectar nueva|Integración/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("searchbox", { name: "Buscar integraciones" }).fill("home");
  await expect(dialog.getByRole("button", { name: /^GitHub/ })).toBeHidden();
  await dialog.getByRole("button", { name: /Home Assistant/ }).click();
  await dialog.getByLabel("Address").fill("http://homeassistant.local:8123/");
  await dialog.getByLabel("Long-lived access token").fill("ha-e2e-token-000");
  await dialog.getByRole("button", { name: "Conectar" }).click();
  await expect(dialog).toBeHidden();
  const servers = (await rpc<{ servers: Array<{ name: string; target: string }> }>("mcp.list")).servers;
  expect(servers.find((s) => s.name === "home-assistant")?.target).toBe("http://homeassistant.local:8123/api/mcp");
  expect(JSON.stringify(servers)).not.toContain("ha-e2e-token-000");
  await page.getByRole("button", { name: "Desconectar" }).click();
  await expect.poll(async () => (await rpc<{ servers: Array<{ name: string }> }>("mcp.list")).servers.length).toBe(0);
});

test("an extension's routine says what and when, waits to be added, and once in Routines says so", async ({ page }) => {
  await rpc("extensions.install", { path: path.resolve(import.meta.dirname, "../../examples/extensions/daily-brief") });
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Extensiones/ }).click();
  await expect(page.getByText("Rutinas que sugiere")).toBeVisible();
  await page.getByRole("button", { name: "Agregar a Rutinas" }).click();
  await expect(page.getByText("En Rutinas · apagada")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar a Rutinas" })).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir en Rutinas" }).click();
  await expect(page.getByText("Morning brief").first()).toBeVisible();
});

test("APX's own skills are listed with an APX tag, always on and read-only", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Skills/ }).click();
  await page.getByRole("button", { name: /^apx-mcps/ }).click();
  const detail = page.getByRole("article");
  await expect(detail.getByRole("heading", { name: "apx-mcps" })).toBeVisible();
  await expect(detail.getByText("APX", { exact: true })).toBeVisible();
  await expect(detail.getByRole("switch")).toHaveCount(0);
  await expect(detail.getByText(/^Viene con APX y les enseña a los agentes a cambiar APX/)).toBeVisible();
  await expect(detail.getByText(/apx mcps add/).first()).toBeVisible();
});

test("other apps' skills show their tag and duplicates; the engines filter narrows; a folder is read, then imported", async ({
  page,
}) => {
  const { dir } = await world.info();
  const skill = (root: string, name: string, description: string, extra: Record<string, string> = {}) => {
    for (const [file, text] of Object.entries({
      "SKILL.md": `---\nname: ${name}\ndescription: ${description}\n---\nHow.\n`,
      ...extra,
    })) {
      fs.mkdirSync(path.dirname(path.join(root, name, file)), { recursive: true });
      fs.writeFileSync(path.join(root, name, file), text);
    }
  };
  skill(path.join(dir, "claude", "skills"), "acme-deck", "Makes Acme decks.");
  skill(path.join(dir, "claude", "skills"), "acme-memo", "Claude's memo.");
  await rpc("skills.save", {
    name: "acme-memo",
    target: "global",
    content: "---\nname: acme-memo\ndescription: APX's memo.\n---\nHow.\n",
  });
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Skills/ }).click();
  await expect(page.getByRole("button", { name: /^acme-deck.*Claude/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^acme-memo.*Duplicada/ })).toBeVisible();
  await page.getByRole("button", { name: /^acme-memo/ }).click();
  await expect(page.getByRole("article").getByText("Distinta")).toBeVisible();

  await page.getByRole("button", { name: "Todos los motores" }).click();
  await page.getByRole("menuitem", { name: "Claude" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^acme-deck/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^apx-mcps/ })).toHaveCount(0);
  // In Claude only as an unused copy: listed, with Claude's tag dimmed and saying so.
  await expect(page.getByTitle("Copia en Claude: los agentes no la usan")).toBeVisible();
  await expect(page.getByText(/Mostrando las de Claude/)).toBeVisible();
  await page.getByRole("button", { name: "Claude", exact: true }).click();
  await page.getByRole("menuitem", { name: "Claude" }).click();
  await page.keyboard.press("Escape");

  // "Use this one" on Claude's copy: it takes the place of APX's, and the copy is now the same.
  await page.getByRole("article").getByRole("button", { name: "Usar esta" }).click();
  const use = page.getByRole("dialog", { name: "Usar esta" });
  await expect(use.getByRole("checkbox", { name: "Reemplazar las que ya existen" })).toBeChecked();
  await use.getByRole("button", { name: "Importar 1" }).click();
  await expect(use).toBeHidden();
  await expect(page.getByRole("article").getByText("Claude's memo.")).toBeVisible();
  await expect(page.getByRole("article").getByText("Igual")).toBeVisible();

  const source = path.join(dir, "import-src");
  skill(source, "northwind-notes", "Takes Northwind notes.", { "scripts/run.sh": "echo hi\n" });
  await page.getByRole("button", { name: "Skill", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Importar" }).click();
  await dialog.getByRole("textbox", { name: "Carpeta" }).fill(source);
  await dialog.getByRole("button", { name: "Leer" }).click();
  await expect(dialog.getByText("Trae scripts que un agente podría ejecutar: scripts/run.sh")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "northwind-notes" })).toBeChecked();
  expect(fs.existsSync(path.join(dir, "apx-home", "skills", "northwind-notes")), "a preview copies nothing").toBe(
    false,
  );
  await dialog.getByRole("button", { name: "Importar 1" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /^northwind-notes/ })).toBeVisible();
  expect(fs.readFileSync(path.join(dir, "apx-home", "skills", "northwind-notes", "scripts", "run.sh"), "utf8")).toBe(
    "echo hi\n",
  );
});

test("inside a project, Project shows only its own MCP servers and variables", async ({ page }) => {
  const { repo } = await world.info();
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  await rpc("mcp.set", { name: "acme-own", project, server: { command: "npx", args: ["-y", "@acme/own"] } });
  await rpc("mcp.set", { name: "globex-shared", server: { command: "npx", args: ["-y", "@acme/shared"] } });
  await rpc("secrets.set", { name: "ACME_ONLY", value: "acme-only-value", project });
  await open(page, `#project=${project}&tab=resources`);
  await page.getByRole("radio", { name: /^MCP/ }).click();
  await expect(page.getByRole("button", { name: /^globex-shared/ })).toBeVisible();
  await page.getByRole("radio", { name: "Proyecto", exact: true }).click();
  await expect(page.getByRole("button", { name: /^acme-own/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^globex-shared/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Todos los motores" })).toHaveCount(0);
  await page.getByRole("radio", { name: /^Variables/ }).click();
  await expect(page.getByText("ACME_ONLY")).toBeVisible();
  await expect(page.getByText("NORTHWIND_API")).toHaveCount(0);
  await page.getByRole("radio", { name: "Todas", exact: true }).click();
  await expect(page.getByText("NORTHWIND_API")).toBeVisible();
});
