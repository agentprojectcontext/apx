import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("project helper is optional, asks only missing context and stays quiet after dismissal", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  const create = page.getByRole("dialog");
  await expect(create.getByRole("checkbox", { name: "Ofrecer ayuda para preparar este proyecto" })).not.toBeChecked();
  await create.getByRole("radio", { name: "Sin carpeta" }).click();
  await create.getByRole("textbox", { name: "Nombre" }).fill("Helper storefront");
  await create.getByRole("checkbox", { name: "Ofrecer ayuda para preparar este proyecto" }).check();
  await create.getByRole("button", { name: "Sumar" }).click();
  await expect(create).toBeHidden();
  await expect(
    page.getByText("Falta contexto del proyecto o de un agente. ¿Preparamos un próximo paso concreto?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revisar contexto del proyecto" }).click();
  const helper = page.getByRole("dialog", { name: "Revisar contexto del proyecto" });
  await helper.getByRole("textbox", { name: "¿Qué debería lograr este proyecto?" }).fill("Sell the catalog online");
  await helper.getByRole("button", { name: "Un prototipo pequeño que funcione" }).click();
  await expect(helper.getByRole("textbox", { name: "¿Cuál sería un primer resultado útil?" })).toHaveValue(
    "Un prototipo pequeño que funcione",
  );
  await helper.getByRole("button", { name: "Preparar resumen" }).click();
  await expect(
    helper.getByText("El contexto existente alcanza para empezar. No hacen falta más preguntas."),
  ).toBeVisible();
  await expect(helper.getByRole("textbox", { name: "¿Qué debería lograr este proyecto?" })).toHaveCount(0);
  await helper.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.reload();
  await expect(
    page.getByText("Falta contexto del proyecto o de un agente. ¿Preparamos un próximo paso concreto?"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Revisar contexto del proyecto" }).click();
  await helper.getByRole("button", { name: "Desactivar ayuda proactiva" }).click();
  await expect(helper.getByRole("button", { name: "Activar ayuda proactiva" })).toBeVisible();
  await helper.getByRole("button", { name: "Cerrar", exact: true }).click();
});

test("manual agent review works off; custom instructions stay intact and proposals require acceptance", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<Result<"projects.create">>("projects.create", {
    name: "Helper editorial",
    description: "Publish the catalog.",
  });
  await rpc("projects.helper_set", { project: project.id, first_result: "A reviewed catalog" });
  await open(page, `#project=${project.id}&tab=team`);
  await page.getByRole("button", { name: "Agente", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Nuevo agente" });
  await create.getByRole("textbox", { name: "Rol", exact: true }).fill("Editor");
  await create.getByRole("textbox", { name: "Prompt", exact: true }).fill("Keep this custom instruction exactly.");
  await create.getByRole("button", { name: "Revisar borrador con el contexto del proyecto" }).click();
  const helper = page.getByRole("dialog", { name: "Revisar contexto del proyecto" });
  await expect(helper.getByRole("button", { name: "Activar ayuda proactiva" })).toBeVisible();
  await expect(helper.getByRole("button", { name: "Usar estas instrucciones propuestas" })).toHaveCount(0);
  await helper.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(create.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Keep this custom instruction exactly.",
  );
  await create.getByRole("textbox", { name: "Prompt", exact: true }).fill("");
  await create.getByRole("button", { name: "Revisar borrador con el contexto del proyecto" }).click();
  await expect(helper.getByRole("textbox", { name: "Instrucciones propuestas (sin aplicar)" })).toHaveValue(
    /Publish the catalog/,
  );
  await helper.getByRole("button", { name: "Revisar cambio propuesto" }).click();
  const confirm = page.getByRole("dialog", { name: "¿Aplicar las instrucciones propuestas?" });
  await expect(confirm.getByRole("textbox", { name: "Antes (eliminado)" })).toHaveValue("");
  await expect(confirm.getByRole("textbox", { name: "Después (agregado)" })).toHaveValue(/Publish the catalog/);
  await confirm.getByRole("button", { name: "Cancelar", exact: true }).click();
  await helper.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(create.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue("");
  await create.getByRole("button", { name: "Revisar borrador con el contexto del proyecto" }).click();
  await helper.getByRole("button", { name: "Revisar cambio propuesto" }).click();
  await confirm.getByRole("button", { name: "Usar estas instrucciones propuestas" }).click();
  await expect(create.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(/"role": "Editor"/);
  await create.getByRole("button", { name: "Crear agente", exact: true }).click();
  await expect(create).toBeHidden();
  const { agents } = await rpc<Result<"agents.list">>("agents.list");
  const made = agents.find((a) => a.project_id === project.id);
  expect(made).toBeTruthy();
  const saved = await rpc<Result<"agents.get">>("agents.get", { agent: made?.id });
  expect(saved.prompt).toMatch(/"role": "Editor"/);
  expect(saved.agent.rules).toBeUndefined();
  expect(saved.agent.autonomy).toBeUndefined();
});

test("navigation away from proposal confirmation never creates or modifies an agent", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<Result<"projects.create">>("projects.create", {
    name: "Helper cancellation",
    description: "Review the catalog.",
  });
  const existing = await rpc<Result<"agents.create">>("agents.create", {
    project_id: project.id,
    slug: "editor",
    name: "Editor",
    role: "Reviewer",
    prompt: "Keep the existing instructions.",
  });
  const before = await rpc<Result<"agents.get">>("agents.get", { agent: existing.id });
  await open(page, `#project=${project.id}&tab=team`);
  await page.getByRole("button", { name: "Agente", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Nuevo agente" });
  await create.getByRole("textbox", { name: "Rol", exact: true }).fill("Reviewer");
  await create.getByRole("button", { name: "Revisar borrador con el contexto del proyecto" }).click();
  const helper = page.getByRole("dialog", { name: "Revisar contexto del proyecto" });
  await helper.getByRole("button", { name: "Revisar cambio propuesto" }).click();
  await expect(page.getByRole("dialog", { name: "¿Aplicar las instrucciones propuestas?" })).toBeVisible();
  await open(page);
  expect(await rpc<Result<"agents.get">>("agents.get", { agent: existing.id })).toEqual(before);
  const { agents } = await rpc<Result<"agents.list">>("agents.list");
  expect(agents.filter((a) => a.project_id === project.id).map((a) => a.id)).toEqual([existing.id]);
});

test("import offers helper mode without changing existing contextual instructions", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  const create = page.getByRole("dialog");
  await create.getByRole("radio", { name: "Importar" }).click();
  await expect(create.getByRole("combobox", { name: "Proyecto" })).toContainText("acme");
  await create.getByRole("checkbox", { name: "Ofrecer ayuda para preparar este proyecto" }).check();
  await create.getByRole("button", { name: "Importar" }).click();
  await expect(create).toBeHidden();
  await page.getByRole("button", { name: "Revisar contexto del proyecto" }).click();
  const helper = page.getByRole("dialog", { name: "Revisar contexto del proyecto" });
  await expect(helper.getByRole("textbox", { name: "¿Qué debería lograr este proyecto?" })).toHaveCount(0);
  await expect(helper.getByRole("textbox", { name: "¿Cuál sería un primer resultado útil?" })).toHaveCount(0);
  await expect(
    helper.getByText("El contexto existente alcanza para empezar. No hacen falta más preguntas."),
  ).toBeVisible();
  await helper.getByRole("button", { name: "Cerrar", exact: true }).click();
});
