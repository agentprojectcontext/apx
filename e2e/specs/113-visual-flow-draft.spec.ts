import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

for (const lang of ["en", "es"] as const) {
  test(`a flow the executor can't run yet saves only as a draft and never runs (${lang})`, async ({ page }) => {
    await rpc("setup.finish");
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Flow ${lang}` })).project.id;
    const flow = `draft-${lang}-${project}`;
    const legacy = {
      id: flow,
      projectId: project,
      name: `Northwind ${lang}`,
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    };
    const baseline = await rpc<typeof legacy>("flows.set", legacy);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    const l =
      lang === "en"
        ? {
            edit: "Edit flow",
            add: "Add Routine",
            addModel: "Add AI model",
            save: "Save",
            draft: "Saved as a draft. It doesn't run like this yet.",
            branch: /splits the path/,
            pending: "Your last changes are saved as a draft and don't run yet. This is what runs now.",
            close: "Close the editor",
          }
        : {
            edit: "Editar flujo",
            add: "Sumar Rutina",
            addModel: "Sumar Modelo IA",
            save: "Guardar",
            draft: "Guardado como borrador. Todavía no corre así.",
            branch: /abre dos caminos/,
            pending: "Tus últimos cambios quedaron como borrador y todavía no corren. Esto es lo que corre ahora.",
            close: "Salir del editor",
          };
    await open(page);
    // The flows screen, its detail and the editor's canvas load only when opened.
    expect(requests.some((url) => /FlowsScreen-.*\.js/.test(url))).toBe(false);
    await page.locator(".sidebar").getByRole("button", { name: "Flows", exact: true }).click();
    await expect.poll(() => requests.some((url) => /FlowsScreen-.*\.js/.test(url))).toBe(true);
    expect(requests.some((url) => /FlowEditor-.*\.js/.test(url))).toBe(false);
    await page.getByRole("button", { name: new RegExp(`^Northwind ${lang}`) }).click();
    await page.getByRole("button", { name: l.edit }).click();
    await expect.poll(() => requests.some((url) => /FlowEditor-.*\.js/.test(url))).toBe(true);
    const editor = page.getByRole("dialog", { name: `Northwind ${lang}` });
    // Two steps after the save make two paths: the executor runs one path for now.
    await editor.locator('.react-flow__node[data-id="save"]').click();
    await editor.getByRole("button", { name: l.addModel }).click();
    const agent = editor.locator(".react-flow__node").last();
    await expect(agent).toBeVisible();
    await editor.getByRole("textbox", { name: lang === "en" ? "Instruction" : "Instrucción" }).fill("Read it.");
    await editor.locator('.react-flow__node[data-id="save"]').click();
    await editor.getByRole("button", { name: l.addModel }).click();
    await editor.getByRole("textbox", { name: lang === "en" ? "Instruction" : "Instrucción" }).fill("Read it too.");
    await editor.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
    await expect(editor.getByText(l.branch)).toBeVisible();
    const calls = await world.llmCalls();
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText(l.draft);
    // The definition that runs is unchanged; the draft keeps the drawing; nothing was published.
    expect((await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]).toEqual(baseline);
    const doc = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
    expect(doc.draft?.nodes.filter((n) => n.kind === "agent")).toHaveLength(2);
    expect(doc.publishedRevision).toBeNull();
    expect(requests.some((url) => url.includes("flows.publish"))).toBe(false);
    await editor.getByRole("button", { name: l.close }).click();
    await expect(page.getByText(l.pending)).toBeVisible();
    // An event still runs the saved definition: saved to the table, no model call.
    const credential = await rpc<Result<"public_routes.rotate">>("public_routes.rotate", { path: `/flows/${flow}` });
    const { value: token } = await rpc<Result<"secrets.reveal">>("secrets.reveal", {
      name: credential.secret_ref.slice(9),
    });
    const { port } = await rpc<Result<"webhooks.get">>("webhooks.get", {});
    const response = await fetch(`http://127.0.0.1:${port}/flows/${flow}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: "one", data: { text: "Northwind" } }),
    });
    expect(((await response.json()) as { state: string }).state).toBe("written");
    expect(await world.llmCalls()).toBe(calls);
  });
}
