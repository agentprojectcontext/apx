import type { FlowGraph } from "../../packages/protocol/src/flow-graph.ts";
import { expect, rpc, test, world } from "./kit.ts";

for (const lang of ["en", "es"] as const) {
  test(`visual draft persists, detects conflicts and never executes (${lang})`, async ({ page }) => {
    await rpc("setup.finish");
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Flow ${lang}` })).project.id;
    const flow = `visual-${lang}-${project}`;
    const legacy = {
      id: flow,
      projectId: project,
      name: `Visual ${lang}`,
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    };
    const baseline = await rpc<typeof legacy>("flows.set", legacy);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
      localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true, welcome: true }));
    }, lang);
    const labels =
      lang === "en"
        ? {
            visual: "Visual draft",
            zoom: "Zoom in",
            zoomOut: "Zoom out",
            fit: "Fit view",
            save: "Save draft",
            back: "Back to Flows",
            unsaved: "Unsaved changes",
            saved: "No unsaved changes",
            name: "Name",
            validate: "Validate",
            unavailable: "Graph execution is unavailable",
            error: "Could not complete the operation",
            legacy: "Edit Flow",
          }
        : {
            visual: "Borrador visual",
            zoom: "Acercar",
            zoomOut: "Alejar",
            fit: "Encuadrar",
            save: "Guardar borrador",
            back: "Volver a Flows",
            unsaved: "Cambios sin guardar",
            saved: "Sin cambios pendientes",
            name: "Nombre",
            validate: "Validar",
            unavailable: "La ejecución de grafos no está disponible",
            error: "No se pudo completar la operación",
            legacy: "Editar Flow",
          };
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Flows", exact: true })).toBeVisible();
    expect(requests.some((url) => /FlowsPane-.*\.(js|css)/.test(url))).toBe(false);
    await page.getByRole("button", { name: "Flows", exact: true }).click();
    await expect.poll(() => requests.some((url) => /FlowsPane-.*\.js/.test(url))).toBe(true);
    const row = page.locator(".flow-item").filter({ hasText: `Visual ${lang}` });
    await expect(row.getByRole("button", { name: labels.legacy })).toBeVisible();
    const calls = await world.llmCalls();
    await row.getByRole("button", { name: labels.visual }).click();
    await expect(page.getByRole("button", { name: labels.zoom })).toBeVisible();
    await expect(page.getByRole("button", { name: labels.zoomOut })).toBeVisible();
    await expect(page.getByRole("button", { name: labels.fit })).toBeVisible();
    await expect(page.getByText(labels.unavailable).first()).toBeVisible();
    const name = page.getByLabel(labels.name, { exact: true });
    await name.fill(`Webhook ${lang}`);
    await expect(page.getByText(labels.unsaved)).toBeVisible();
    await page.getByRole("button", { name: labels.validate, exact: true }).click();
    await page.getByRole("button", { name: labels.save, exact: true }).click();
    await expect(page.getByText(labels.saved)).toBeVisible();
    const saved = await rpc<{ draftVersion: number; draft: FlowGraph }>("flows.graph_get", { flow });
    expect(saved.draftVersion).toBe(1);
    expect(saved.draft.nodes[0]?.label).toBe(`Webhook ${lang}`);
    await page.getByRole("button", { name: labels.back }).click();
    await page.reload();
    await row.getByRole("button", { name: labels.visual }).click();
    await expect(page.getByLabel(labels.name, { exact: true })).toHaveValue(`Webhook ${lang}`);
    await name.fill(`Local ${lang}`);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: labels.back }).click();
    await expect(page.getByLabel(labels.name, { exact: true })).toHaveValue(`Local ${lang}`);
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await page.getByRole("button", { name: "Flows", exact: true }).click();
    await page
      .locator(".flow-item")
      .filter({ hasText: `Visual ${lang}` })
      .getByRole("button", { name: labels.visual })
      .click();
    await expect(page.getByLabel(labels.name, { exact: true })).toHaveValue(`Local ${lang}`);
    await rpc("flows.draft_save", { flow, expectedVersion: 1, graph: saved.draft });
    // Keep the core's conflict body while avoiding Chromium's expected 409 console error (see kit.ts).
    await page.route(
      "**/rpc/flows.draft_save",
      async (route) => {
        const reply = await route.fetch();
        expect(reply.status()).toBe(409);
        const body = await reply.json();
        expect(body.ok).toBe(false);
        await route.fulfill({ status: 200, json: body });
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: labels.save, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(labels.error);
    await expect(page.getByLabel(labels.name, { exact: true })).toHaveValue(`Local ${lang}`);
    const after = await rpc<{ draftVersion: number; draft: FlowGraph }>("flows.graph_get", { flow });
    expect(after.draftVersion).toBe(2);
    expect(after.draft.nodes[0]?.label).toBe(`Webhook ${lang}`);
    expect((await rpc<{ flows: (typeof legacy)[] }>("flows.list", { project })).flows).toContainEqual(baseline);
    expect((await rpc<{ events: unknown[] }>("flows.events", { flow, limit: 50 })).events).toEqual([]);
    expect(await world.llmCalls()).toBe(calls);
    expect(requests.some((url) => url.endsWith("/rpc/flows.publish"))).toBe(false);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: labels.back }).click();
    await expect(row.getByRole("button", { name: labels.legacy })).toBeVisible();
  });
}

for (const lang of ["en", "es"] as const) {
  test(`canvas interaction and keyboard alternatives (${lang})`, async ({ page }) => {
    await rpc("setup.finish");
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Canvas ${lang}` })).project.id;
    const flow = `canvas-${lang}-${project}`;
    await rpc("flows.set", {
      id: flow,
      projectId: project,
      name: `Canvas ${lang}`,
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
      localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true, welcome: true }));
    }, lang);
    const l =
      lang === "en"
        ? {
            visual: "Visual draft",
            add: "Add block",
            fit: "Fit view",
            condition: "Condition",
            input: "Value to compare",
            compare: "Compare against",
            list: "Block list",
            right: "Right",
            source: "From",
            target: "To",
            connect: "Connect",
            save: "Save draft",
            saved: "No unsaved changes",
            unavailable: "Graph execution is unavailable",
            settings: "Block settings",
            added: "Connection added",
            removeConnection: "Remove connection: webhook → node-1",
          }
        : {
            visual: "Borrador visual",
            add: "Agregar bloque",
            fit: "Encuadrar",
            condition: "Condición",
            input: "Valor a comparar",
            compare: "Comparar con",
            list: "Lista de bloques",
            right: "Derecha",
            source: "Desde",
            target: "Hasta",
            connect: "Conectar",
            save: "Guardar borrador",
            saved: "Sin cambios pendientes",
            unavailable: "La ejecución de grafos no está disponible",
            settings: "Configuración del bloque",
            added: "Conexión agregada",
            removeConnection: "Quitar conexión: webhook → node-1",
          };
    await page.goto("/");
    await page.getByRole("button", { name: "Flows", exact: true }).click();
    await page
      .locator(".flow-item")
      .filter({ hasText: `Canvas ${lang}` })
      .getByRole("button", { name: l.visual })
      .click();
    await expect(page.getByText(l.unavailable)).toHaveCount(1);
    const canvas = page.locator(".fg-canvas");
    const webhook = canvas.locator('[data-id="webhook"]');
    await page.getByRole("button", { name: l.add, exact: true }).click();
    const condition = canvas.locator('[data-id="node-1"]');
    await expect(condition).toBeVisible();
    const withinCanvas = async (selector: string) => {
      const bounds = await canvas.boundingBox();
      const node = await canvas.locator(selector).boundingBox();
      if (!bounds || !node) return false;
      return (
        node.x >= bounds.x &&
        node.y >= bounds.y &&
        node.x + node.width <= bounds.x + bounds.width &&
        node.y + node.height <= bounds.y + bounds.height
      );
    };
    await expect.poll(() => withinCanvas('[data-id="node-1"]')).toBe(true);
    const width = await canvas.boundingBox();
    expect(width?.width ?? 0).toBeGreaterThan(500);
    await expect(page.getByRole("group", { name: l.input })).toBeVisible();
    await expect(page.getByRole("group", { name: l.compare })).toBeVisible();
    await page.getByRole("button", { name: l.fit }).click();
    await expect.poll(() => withinCanvas('[data-id="webhook"]')).toBe(true);
    await expect.poll(() => withinCanvas('[data-id="node-1"]')).toBe(true);

    // Keyboard selection and movement persist in the graph, not just in React Flow's local state.
    await condition.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: l.save, exact: true }).click();
    await expect(page.getByText(l.saved)).toBeVisible();
    const afterKey = await rpc<{ draft: FlowGraph }>("flows.graph_get", { flow });
    expect(afterKey.draft.layout.find((point) => point.node === "node-1")?.x).toBeGreaterThan(280);

    await condition.scrollIntoViewIfNeeded();
    const beforeDrag = await condition.boundingBox();
    if (!beforeDrag) throw new Error("Condition block has no bounds");
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 100, beforeDrag.y + beforeDrag.height / 2 + 60, {
      steps: 8,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: l.save, exact: true }).click();
    await expect(page.getByText(l.saved)).toBeVisible();
    const afterDrag = await rpc<{ draft: FlowGraph }>("flows.graph_get", { flow });
    expect(afterDrag.draft.layout.find((point) => point.node === "node-1")?.x).toBeGreaterThan(
      afterKey.draft.layout.find((point) => point.node === "node-1")?.x ?? 0,
    );
    await page.getByRole("button", { name: l.fit }).click();
    const sourceHandle = webhook.locator(".source");
    const targetHandle = condition.locator(".target");
    await expect(sourceHandle).toBeVisible();
    await expect(targetHandle).toBeVisible();
    await sourceHandle.hover();
    const from = await sourceHandle.boundingBox();
    const to = await targetHandle.boundingBox();
    if (!from || !to) throw new Error("Connection handles have no bounds");
    expect(
      await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, {
        x: from.x + from.width / 2,
        y: from.y + from.height / 2,
      }),
    ).toContain("source");
    expect(
      await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, {
        x: to.x + to.width / 2,
        y: to.y + to.height / 2,
      }),
    ).toContain("target");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByText(l.added, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: l.removeConnection }).click();

    await page.getByText(l.list, { exact: true }).click();
    const blockList = page.locator(".fg-list");
    await blockList.getByRole("button", { name: /Webhook/ }).focus();
    await page.keyboard.press("Enter");
    await expect(blockList.getByRole("button", { name: /Webhook/ })).toHaveAttribute("aria-pressed", "true");
    const settings = page.getByRole("complementary", { name: l.settings });
    await settings.getByRole("button", { name: l.right }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("combobox", { name: l.source, exact: true }).selectOption("webhook");
    await page.getByRole("combobox", { name: l.target, exact: true }).selectOption("node-1");
    await page.getByRole("button", { name: l.connect, exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: l.save, exact: true }).click();
    await expect(page.getByText(l.saved)).toBeVisible();
    const after = await rpc<{ draft: FlowGraph }>("flows.graph_get", { flow });
    expect(after.draft.edges).toEqual([{ source: "webhook", target: "node-1" }]);
    expect(after.draft.layout.find((point) => point.node === "webhook")?.x).toBe(80);
    await expect(webhook).toBeVisible();
    for (let i = 0; i < 8; i++) await page.getByRole("button", { name: l.add, exact: true }).click();
    await expect.poll(() => withinCanvas('[data-id="node-9"]')).toBe(true);
    await page.getByRole("button", { name: l.fit }).click();
    await expect.poll(() => withinCanvas('[data-id="webhook"]')).toBe(true);
    await expect.poll(() => withinCanvas('[data-id="node-9"]')).toBe(true);
    await page.setViewportSize({ width: 700, height: 800 });
    const editorBounds = await page.locator(".fg-editor").boundingBox();
    expect((editorBounds?.x ?? 700) + (editorBounds?.width ?? 700)).toBeLessThanOrEqual(700);
    await expect(page.getByRole("complementary", { name: l.settings })).toBeVisible();
  });
}
