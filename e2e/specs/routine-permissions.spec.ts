// A routine made on the Routines page says where it runs (its project's tools come with it) and how its runs act,
// over its agent's own permissions (DECISIONS.md#d-223).
import { expect, open, rpc, test } from "./kit.ts";

type Project = { id: string; name: string };
type Agent = { id: string; name: string };
type Routine = { id: string; name: string; agent_id: string; project_id?: string; autonomy?: string };

let project: Project;
let agent: Agent;

test.beforeAll(async () => {
  await rpc("setup.finish");
  project = (await rpc<{ project: Project }>("projects.create", { name: "Northwind field" })).project;
  agent = await rpc<Agent>("agents.create", { slug: "field-scout", name: "Field Scout", project_id: project.id });
});

for (const width of [1280, 390]) {
  test(`a routine for a project's agent runs in its project and on its own permissions (${width}px)`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await open(page, "#view=routines");
    await page.getByRole("button", { name: "Nueva rutina" }).first().click();
    const editor = page.getByRole("dialog", { name: "Nueva rutina" });
    await editor.getByRole("textbox", { name: "Nombre" }).fill(`Field check ${width}`);
    // Picking a project's agent puts the routine in that project.
    await editor.getByRole("combobox", { name: "Agente" }).click();
    await page.getByPlaceholder("Buscá un agente").fill("Field Scout");
    await page.getByRole("option", { name: /Field Scout/ }).click();
    await expect(editor.getByRole("combobox", { name: "Proyecto" })).toContainText("Northwind field");
    // Its runs act on Total, whatever the agent's own mode; the field says that is only this routine.
    await editor.getByRole("combobox", { name: "Permisos" }).click();
    await expect(page.getByRole("option", { name: /^Como su agente/ })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`routine-permissions-${width}.png`) });
    await page.getByRole("option", { name: /^Total/ }).click();
    await expect(editor.getByRole("combobox", { name: "Permisos" })).toContainText("Total");
    await expect(editor.getByText("Solo las corridas de esta rutina")).toBeVisible();
    await editor.getByRole("textbox", { name: "Qué hacer" }).fill("Check the field reports and tell me what changed");
    const box = await editor.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`routine-editor-${width}.png`), fullPage: true });
    await editor.getByRole("button", { name: "Guardar" }).click();
    await expect(editor).toBeHidden();

    const { routines } = await rpc<{ routines: Routine[] }>("routines.list", {});
    const saved = routines.find((r) => r.name === `Field check ${width}`);
    expect(saved?.agent_id).toBe(agent.id);
    expect(saved?.project_id).toBe(project.id);
    expect(saved?.autonomy).toBe("total");

    // Opened again, it shows what it has; going back to its agent's own permissions clears the choice.
    await page.getByText(`Field check ${width}`).first().click();
    await page.getByRole("button", { name: "Editar rutina" }).first().click();
    const again = page.getByRole("dialog", { name: "Editar rutina" });
    await expect(again.getByRole("combobox", { name: "Permisos" })).toContainText("Total");
    await again.getByRole("combobox", { name: "Permisos" }).click();
    await page.getByRole("option", { name: /^Como su agente/ }).click();
    await again.getByRole("button", { name: "Guardar" }).click();
    await expect(again).toBeHidden();
    const after = (await rpc<{ routines: Routine[] }>("routines.list", {})).routines.find((r) => r.id === saved?.id);
    expect(after?.autonomy).toBeUndefined();
    expect(after?.project_id).toBe(project.id);
  });
}
