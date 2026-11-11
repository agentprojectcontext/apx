// Resources › Variables: a link opens one found and picked; a project's variable moves to another project or to every
// project without typing it again; text goes on both sides of a variable chip in a value field.
import { expect, open, rpc, test } from "./kit.ts";

type Listed = { secrets: Array<{ name: string; project_id?: string }> };

test("a link to a variable opens Variables with it found and picked", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("secrets.set", { name: "NORTHWIND_LINKED", value: "nw-linked-0123456789" });
  await rpc("secrets.set", { name: "NORTHWIND_OTHER", value: "nw-other-0123456789" });
  await open(page, "#view=resources&variable=NORTHWIND_LINKED");
  await expect(page.getByRole("radio", { name: /^Variables/ })).toBeChecked();
  await expect(page.getByRole("searchbox")).toHaveValue("NORTHWIND_LINKED");
  const row = page.getByRole("row", { name: /NORTHWIND_LINKED/ });
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("row", { name: /NORTHWIND_OTHER/ })).toHaveCount(0);
  // Another tab forgets it.
  await page.getByRole("radio", { name: /^MCP/ }).click();
  await expect(page).not.toHaveURL(/variable=/);
});

test("a project's variable moves to another project, then to every project, keeping its value", async ({ page }) => {
  await rpc("setup.finish", {});
  // Its own names, so a retry on the same core starts clean.
  const run = Date.now().toString(36);
  const name = `ACME_MOVING_${run.toUpperCase()}`;
  const acme = (await rpc<{ project: { id: string } }>("projects.create", { name: `Acme vars ${run}` })).project.id;
  const globex = (await rpc<{ project: { id: string } }>("projects.create", { name: `Globex vars ${run}` })).project.id;
  await rpc("secrets.set", { name, value: "acme-moving-0123456789", project: acme });
  await open(page, `#view=resources&variable=${name}`);

  await page.getByRole("button", { name: `Editar ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Editar ${name}` });
  await expect(edit.getByLabel("Valor")).toHaveAttribute("placeholder", "Dejalo vacío para mantener el actual");
  await edit.getByRole("combobox", { name: "Disponible en" }).click();
  await page.getByRole("option", { name: `Globex vars ${run}` }).click();
  await edit.getByRole("button", { name: "Guardar" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText(`Globex vars ${run}`);
  const moved = (await rpc<Listed>("secrets.list", {})).secrets.filter((s) => s.name === name);
  expect(moved.map((s) => s.project_id)).toEqual([globex]);
  expect(await rpc("secrets.reveal", { name, project: globex })).toEqual({
    value: "acme-moving-0123456789",
  });
  await page.screenshot({ path: test.info().outputPath("moved-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: `Editar ${name}` }).click();
  await edit.getByRole("combobox", { name: "Disponible en" }).click();
  await page.getByRole("option", { name: "Todos los proyectos" }).click();
  await edit.getByRole("button", { name: "Guardar" }).click();
  await expect(edit).toBeHidden();
  const global = (await rpc<Listed>("secrets.list", {})).secrets.filter((s) => s.name === name);
  expect(global.map((s) => s.project_id)).toEqual([undefined]);
  expect(await rpc("secrets.reveal", { name })).toEqual({ value: "acme-moving-0123456789" });
});

test("text can be typed after a variable chip inserted into an empty value, and before it", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("secrets.set", { name: "NORTHWIND_BEARER", value: "nw-bearer-0123456789" });
  await open(page, "#view=resources");
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^MCP/ }).click();
  await page.getByRole("button", { name: "MCP", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nuevo servidor MCP" });
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("northwind-typed");
  await dialog.getByRole("textbox", { name: "Comando" }).fill("npx -y @acme/mcp-server");
  await dialog.getByRole("textbox", { name: "Clave" }).fill("AUTH");
  await dialog.getByRole("button", { name: "Usar una variable" }).click();
  await page.getByRole("option", { name: "NORTHWIND_BEARER" }).click();
  const value = dialog.getByRole("textbox", { name: "Valor" });
  await expect(value).toBeFocused();
  await page.keyboard.type("/v1");
  await page.keyboard.press("Home");
  await page.keyboard.type("Bearer ");
  await expect(value).toHaveText("Bearer NORTHWIND_BEARER×/v1");
  await page.screenshot({ path: test.info().outputPath("chip-typing.png") });
  await dialog.getByRole("button", { name: "Crear" }).click();
  await expect(dialog).toBeHidden();
  const servers = (
    await rpc<{ servers: Array<{ name: string; definition?: { env: Record<string, string> } }> }>("mcp.list")
  ).servers;
  expect(servers.find((s) => s.name === "northwind-typed")?.definition?.env).toEqual({
    AUTH: "Bearer secret://NORTHWIND_BEARER/v1",
  });
  await rpc("mcp.set", { name: "northwind-typed", server: null });
});
