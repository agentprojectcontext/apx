import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

test("project Flows can be created, validated, edited and disabled with durable JSON rows", async ({ page }) => {
  await rpc("setup.finish", {});
  const { repo, dir } = await world.info();
  const { project } = await rpc<{ project: { id: string } }>("projects.register", { path: repo });
  const other = path.join(dir, "work", "flow-other");
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, "AGENTS.md"), "# Other project\n");
  const second = await rpc<{ project: { id: string } }>("projects.register", { path: other });
  await open(page, `#project=${project.id}&tab=routines`);
  await page.getByRole("button", { name: "Flows", exact: true }).click();
  const pane = page.getByRole("region", { name: "Flows", exact: true });
  await pane.getByRole("button", { name: "Nuevo Flow" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("textbox", { name: "Proyecto", exact: true })).toHaveValue(project.id);
  await editor.getByRole("textbox", { name: "ID del Flow" }).fill("ui_intake");
  await editor.getByRole("textbox", { name: "Nombre", exact: true }).fill("Acme intake");
  await editor.getByRole("textbox", { name: "Claves de lectura (JSON)" }).fill('["settings","key,with,commas"]');
  await editor.getByRole("textbox", { name: "Filtros (JSON)" }).fill("{}");
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Revisá");
  await editor.getByRole("textbox", { name: "Filtros (JSON)" }).fill('[{"path":["type"],"equals":"message"}]');
  await editor.getByRole("switch", { name: "Activado", exact: true }).click();
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(pane.getByText("/flows/ui_intake", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "Acme intake", exact: true }).click();
  const credential = await rpc<{ secret_ref: string }>("public_routes.rotate", { path: "/flows/ui_intake" });
  const { value: token } = await rpc<{ value: string }>("secrets.reveal", { name: credential.secret_ref.slice(9) });
  const { port } = await rpc<{ port: number }>("webhooks.get", {});
  const delivered = await fetch(`http://127.0.0.1:${port}/flows/ui_intake`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: "ui_event", data: { type: "message", text: "Webhook row" } }),
  });
  expect(delivered.status).toBe(202);
  await pane.locator(".flow-detail").getByRole("button", { name: "Actualizar", exact: true }).click();
  const history = pane.getByRole("region", { name: "Eventos recientes" });
  await expect(history.getByRole("cell", { name: "ui_event", exact: true })).toBeVisible();
  await expect(history.getByRole("cell", { name: "Escrito", exact: true })).toBeVisible();
  const table = pane.getByRole("region", { name: "Tabla persistente" });
  await expect(table.getByText("Webhook row", { exact: false })).toBeVisible();
  await table.getByRole("textbox", { name: "Clave de la fila" }).fill("manual");
  await table.getByRole("textbox", { name: "Valor de la fila (JSON)" }).fill("{");
  await table.getByRole("button", { name: "Escribir fila" }).click();
  await expect(pane.getByRole("alert")).toContainText("JSON válido");
  await table
    .getByRole("textbox", { name: "Valor de la fila (JSON)" })
    .fill('{"message":"<script>outside data</script>"}');
  await table.getByRole("button", { name: "Escribir fila" }).click();
  await expect(table.getByText('"message": "<script>outside data</script>"', { exact: false })).toBeVisible();
  const saved = await rpc<{ rows: Array<{ key: string; value: unknown }> }>("flows.rows", { flow: "ui_intake" });
  expect(saved.rows).toContainEqual({ key: "manual", value: { message: "<script>outside data</script>" } });
  await pane.getByRole("button", { name: "Editar Flow", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "ID del Flow" })).toHaveAttribute("readonly", "");
  await expect(editor.getByRole("textbox", { name: "Claves de lectura (JSON)" })).toHaveValue(
    '["settings","key,with,commas"]',
  );
  await editor.getByRole("switch", { name: "Activado", exact: true }).click();
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(pane.getByText("Desactivado", { exact: true })).toBeVisible();
  const list = await rpc<{ flows: Array<{ id: string; enabled: boolean }> }>("flows.list", { project: project.id });
  expect(list.flows.find((flow) => flow.id === "ui_intake")?.enabled).toBe(false);
  await open(page, `#project=${second.project.id}&tab=routines`);
  await expect(page.getByRole("button", { name: "Flows", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(pane.getByText("Todavía no hay Flows en este proyecto.")).toBeVisible();
  await expect(pane.getByText("Acme intake", { exact: true })).toHaveCount(0);
});
