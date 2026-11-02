import type { Task } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("accept all proposals requires confirmation and preserves the reviewed selection", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Proposal confirmation" });
  const create = (title: string) =>
    rpc<Task>("tasks.create", { title, description: "Review before starting.", project: project.id, propose: true });
  const outside = await rpc<Task>("tasks.create", {
    title: "Proposal from another project",
    description: "Not part of the filtered list.",
    propose: true,
  });
  const first = await create("Review the draft");
  const second = await create("Check the figures");
  const get = async (id: string) => (await rpc<{ task: Task }>("tasks.get", { task: id })).task;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/tasks.update")) writes.push(request.postData() ?? "");
  });
  await open(page);
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByRole("combobox", { name: "Proyecto", exact: true }).click();
  await page.getByRole("option", { name: "Proposal confirmation" }).click();
  const acceptAll = page.getByRole("button", { name: "Aceptar todas", exact: true });
  const dialog = page.getByRole("dialog", { name: "¿Aceptar estas propuestas?" });
  for (const dismiss of ["cancel", "escape", "close", "backdrop"] as const) {
    await acceptAll.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("2 propuestas");
    await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
    expect(writes).toHaveLength(0);
    expect((await get(first.id)).proposed).toBe(true);
    expect((await get(second.id)).proposed).toBe(true);
    if (dismiss === "cancel") await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    if (dismiss === "escape") await page.keyboard.press("Escape");
    if (dismiss === "close") await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    if (dismiss === "backdrop") await page.locator(".apx-dialog__backdrop").click({ position: { x: 5, y: 5 } });
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(0);
  }
  await acceptAll.click();
  await expect(dialog).toBeVisible();
  const later = await create("Arrived after the dialog opened");
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/tasks.update", async (route) => {
    await held;
    await route.continue();
  });
  const confirm = dialog.getByRole("button", { name: "Aceptar 2 propuestas", exact: true });
  try {
    await confirm.dblclick();
    await expect(confirm).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
    await expect.poll(() => writes.length).toBe(1);
  } finally {
    release();
  }
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await get(first.id)).proposed).toBeUndefined();
  expect((await get(second.id)).proposed).toBeUndefined();
  expect((await get(later.id)).proposed).toBe(true);
  expect((await get(outside.id)).proposed).toBe(true);
  expect(writes).toHaveLength(2);
});

for (const language of ["en", "es"] as const) {
  test(`the ${language} task context menu accepts only its open proposal`, async ({ page }, info) => {
    const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: `Accept one ${language}` });
    const first = await rpc<Task>("tasks.create", { title: "Review the draft", project: project.id, propose: true });
    const second = await rpc<Task>("tasks.create", { title: "Check the figures", project: project.id, propose: true });
    await page.addInitScript(
      ({ language, project }) => {
        localStorage.setItem("apx.prefs", JSON.stringify({ language, tasksProject: project }));
      },
      { language, project: project.id },
    );
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/rpc/tasks.update")) writes.push(request.postData() ?? "");
    });
    await open(page, "#view=tasks");
    const title = page.getByText("Review the draft", { exact: true });
    await title.click({ button: "right" });
    const accept = page.getByRole("menuitem", { name: language === "es" ? "Aceptar" : "Accept", exact: true });
    await expect(accept).toBeVisible();
    expect(writes).toHaveLength(0);
    await page.screenshot({ path: info.outputPath(`context-accept-${language}.png`) });
    await page.keyboard.press("Escape");
    expect((await rpc<{ task: Task }>("tasks.get", { task: first.id })).task.proposed).toBe(true);
    await title.click({ button: "right" });
    await accept.click();
    await expect
      .poll(async () => (await rpc<{ task: Task }>("tasks.get", { task: first.id })).task.proposed)
      .toBeUndefined();
    expect((await rpc<{ task: Task }>("tasks.get", { task: second.id })).task.proposed).toBe(true);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({ task: first.id, proposed: false });
    await expect(page.getByRole("dialog")).toBeHidden();
    await title.click({ button: "right" });
    await expect(accept).toHaveCount(0);
    await page.keyboard.press("Escape");
    await rpc("tasks.close", { task: second.id, state: "dropped" });
    const closedLabel = language === "es" ? "Cerradas hace poco" : "Closed recently";
    const closedSection = page.getByRole("region", { name: closedLabel, exact: true });
    const expandClosed = closedSection
      .getByRole("button", { name: closedLabel, exact: true })
      .filter({ hasText: closedLabel });
    await expect(expandClosed).toHaveAttribute("aria-expanded", "false");
    await expandClosed.click();
    await expect(expandClosed).toHaveAttribute("aria-expanded", "true");
    await page.getByText("Check the figures", { exact: true }).click({ button: "right" });
    await expect(accept).toHaveCount(0);
    expect(writes).toHaveLength(1);
  });
}

for (const change of ["modified", "dropped", "accepted", "deleted"] as const) {
  test(`a ${change} proposal invalidates the whole confirmation without acceptance writes`, async ({ page }) => {
    const { project } = await rpc<{ project: { id: string } }>("projects.create", {
      name: `Changed proposal ${change}`,
    });
    const create = (title: string) => rpc<Task>("tasks.create", { title, project: project.id, propose: true });
    const first = await create("Review the draft");
    const second = await create("Check the figures");
    await page.addInitScript((project) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language: "es", tasksProject: project }));
    }, project.id);
    await open(page, "#view=tasks");
    await page.getByRole("button", { name: "Aceptar todas", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (change === "modified") await rpc("tasks.update", { task: first.id, title: "Changed scope" });
    if (change === "dropped") await rpc("tasks.close", { task: first.id, state: "dropped" });
    if (change === "accepted") await rpc("tasks.update", { task: first.id, proposed: false });
    if (change === "deleted") {
      await rpc("tasks.delete", { task: first.id });
      await expect(page.getByText("Review the draft", { exact: true })).toHaveCount(0);
    }
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/rpc/tasks.update")) writes.push(request.postData() ?? "");
    });
    await dialog.getByRole("button", { name: "Aceptar 2 propuestas", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Estas propuestas cambiaron.", { exact: false }).last()).toBeVisible();
    expect(writes).toHaveLength(0);
    expect((await rpc<{ task: Task }>("tasks.get", { task: second.id })).task.proposed).toBe(true);
  });
}

test("partial acceptance leaves a visible error and the failed proposal available", async ({ page }, info) => {
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Partial acceptance" });
  const first = await rpc<Task>("tasks.create", { title: "First proposal", project: project.id, propose: true });
  const second = await rpc<Task>("tasks.create", { title: "Second proposal", project: project.id, propose: true });
  await page.addInitScript((project) => {
    localStorage.setItem("apx.prefs", JSON.stringify({ language: "es", tasksProject: project }));
  }, project.id);
  await open(page, "#view=tasks");
  await page.route("**/rpc/tasks.update", (route) => {
    if (route.request().postDataJSON().task === second.id) {
      return route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Second proposal refused" } } });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "Aceptar todas", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Aceptar 2 propuestas", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByText("Confirmamos la aceptación de 1 de 2 propuestas. Revisá las restantes antes de volver a intentar.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Second proposal refused", { exact: false })).toHaveCount(0);
  expect((await rpc<{ task: Task }>("tasks.get", { task: first.id })).task.proposed).toBeUndefined();
  expect((await rpc<{ task: Task }>("tasks.get", { task: second.id })).task.proposed).toBe(true);
  await page.screenshot({ path: info.outputPath("partial-es-1280.png") });
});

test("a lost response after acceptance reports uncertainty instead of failure", async ({ page }) => {
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Uncertain acceptance" });
  const proposal = await rpc<Task>("tasks.create", { title: "Review proposal", project: project.id, propose: true });
  await page.addInitScript((project) => {
    localStorage.setItem("apx.prefs", JSON.stringify({ language: "es", tasksProject: project }));
  }, project.id);
  await open(page, "#view=tasks");
  let writes = 0;
  await page.route("**/rpc/tasks.update", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("aborted");
  });
  await page.getByRole("button", { name: "Aceptar todas", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Aceptar 1 propuesta", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByText("No pudimos confirmar si se aceptó. Revisá las propuestas antes de volver a intentar.", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await rpc<{ task: Task }>("tasks.get", { task: proposal.id })).task.proposed).toBeUndefined();
  expect(writes).toBe(1);
});

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    test(`proposal confirmation is readable in ${language} at ${width}px`, async ({ page }, info) => {
      await rpc("setup.finish", {});
      const { project } = await rpc<{ project: { id: string } }>("projects.create", {
        name: `Proposal preview ${language} ${width}`,
      });
      const proposal = await rpc<Task>("tasks.create", {
        title: "Review the draft",
        description: "Review before starting.",
        project: project.id,
        propose: true,
      });
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(
        ({ language, project }) => {
          localStorage.setItem("apx.prefs", JSON.stringify({ language, tasksProject: project }));
        },
        { language, project: project.id },
      );
      await open(page, "#view=tasks");
      await page.getByRole("button", { name: language === "es" ? "Aceptar todas" : "Accept all", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: language === "es" ? "¿Aceptar esta propuesta?" : "Accept this proposal?",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(language === "es" ? "1 propuesta" : "1 proposal");
      const bounds = await dialog.boundingBox();
      if (!bounds) throw new Error("Confirmation dialog has no bounds");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`confirmation-${language}-${width}.png`) });
      await dialog.getByRole("button", { name: language === "es" ? "Cancelar" : "Cancel", exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.route("**/rpc/tasks.update", (route) =>
        route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Proposal acceptance refused" } } }),
      );
      await page.getByRole("button", { name: language === "es" ? "Aceptar todas" : "Accept all", exact: true }).click();
      await dialog
        .getByRole("button", { name: language === "es" ? "Aceptar 1 propuesta" : "Accept 1 proposal", exact: true })
        .click();
      const failure = page.getByText(
        language === "es"
          ? "No pudimos confirmar si se aceptó. Revisá las propuestas antes de volver a intentar."
          : "We couldn’t confirm whether it was accepted. Check the proposals before trying again.",
        { exact: true },
      );
      await expect(failure).toBeVisible();
      await expect(page.getByText("Proposal acceptance refused", { exact: false })).toHaveCount(0);
      expect((await rpc<{ task: Task }>("tasks.get", { task: proposal.id })).task.proposed).toBe(true);
      await page.screenshot({ path: info.outputPath(`error-${language}-${width}.png`) });
      await page
        .locator(".toast")
        .filter({ has: failure })
        .getByRole("button", { name: language === "es" ? "Cerrar" : "Close", exact: true })
        .click();
      await expect(failure).toHaveCount(0);
      await rpc("tasks.delete", { task: proposal.id });
      await expect(
        page.getByRole("button", { name: language === "es" ? "Aceptar todas" : "Accept all", exact: true }),
      ).toBeHidden();
      await page.screenshot({ path: info.outputPath(`empty-${language}-${width}.png`) });
    });
  }
}
