import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

for (const lang of ["en", "es"] as const) {
  test(`a drawing with yes and no branches runs as drawn once saved on, and its run shows each step (${lang})`, async ({
    page,
  }) => {
    await rpc("setup.finish");
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Flow ${lang}` })).project.id;
    const flow = `run-${lang}-${project}`;
    await rpc("flows.set", {
      id: flow,
      projectId: project,
      name: `Northwind ${lang}`,
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    const l =
      lang === "en"
        ? {
            addCheck: "Add Check",
            addSave: "Add Save to table",
            field: "Field",
            is: "Is",
            key: "Key",
            saved: "Saved. New events run it as drawn.",
            close: "Close the editor",
            done: "Complete",
          }
        : {
            addCheck: "Sumar Condición",
            addSave: "Sumar Guardar en la tabla",
            field: "Campo",
            is: "Es",
            key: "Clave",
            saved: "Guardado. Los eventos nuevos lo corren como está dibujado.",
            close: "Salir del editor",
            done: "Completa",
          };
    // A link straight to the flow's editor.
    await open(page, `#view=flows&flow=${flow}&edit=1`);
    await expect.poll(() => requests.some((url) => /FlowEditor-.*\.js/.test(url))).toBe(true);
    const editor = page.getByRole("dialog", { name: `Northwind ${lang}` });
    const node = (id: string) => editor.locator(`.react-flow__node[data-id="${id}"]`);
    await node("save").click();
    await editor.getByRole("button", { name: l.addCheck }).click();
    await editor.getByRole("textbox", { name: l.field, exact: true }).fill("type");
    await editor.getByRole("textbox", { name: l.is, exact: true }).fill("order");
    await editor.getByRole("button", { name: l.addSave }).click();
    await editor.getByRole("textbox", { name: l.key, exact: true }).fill("orders");
    await node("condition-1").click();
    await editor.getByRole("button", { name: l.addSave }).click();
    await editor.getByRole("textbox", { name: l.key, exact: true }).fill("others");
    // The second one goes on the check's «No» branch.
    await node("condition-1").click();
    await editor.locator(".fe-outs__when").nth(1).click();
    await expect(editor.locator(".fe-outs__when.is-no")).toHaveCount(1);
    const calls = await world.llmCalls();
    await editor.getByRole("button", { name: lang === "en" ? "Save" : "Guardar", exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText(l.saved);
    const doc = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
    expect(doc.publishedRevision).toBe(1);
    expect(doc.draft).toBeNull();
    expect(doc.published?.edges).toContainEqual({ source: "condition-1", target: "table_write-2", when: "no" });
    await editor.getByRole("button", { name: l.close }).click();
    // Two events through the public address: one takes «Yes», the other «No». Neither calls a model.
    const credential = await rpc<Result<"public_routes.rotate">>("public_routes.rotate", { path: `/flows/${flow}` });
    const { value: token } = await rpc<Result<"secrets.reveal">>("secrets.reveal", {
      name: credential.secret_ref.slice(9),
    });
    const { port } = await rpc<Result<"webhooks.get">>("webhooks.get", {});
    for (const [id, data] of [
      ["one", { type: "order", item: "Lamp" }],
      ["two", { type: "refund", item: "Chair" }],
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${port}/flows/${flow}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, data }),
      });
      expect(((await response.json()) as { state: string }).state).toBe("pending");
    }
    await expect
      .poll(async () =>
        (await rpc<Result<"flows.rows">>("flows.rows", { flow, limit: 10 })).rows.map((r) => r.key).sort(),
      )
      .toEqual(["latest", "orders", "others"]);
    expect(await world.llmCalls()).toBe(calls);
    // The detail shows the last run, «No» taken: the check said no, only its branch ran.
    await page.reload();
    await expect(page.locator(".fd__runline")).toContainText(l.done);
    await expect(page.locator('.react-flow__node[data-id="condition-1"]')).toContainText("no");
    await page.locator('.react-flow__node[data-id="table_write-2"]').click();
    await expect(page.locator(".fd__io")).toContainText('"item": "Chair"');
    await page.locator('.react-flow__node[data-id="table_write-1"]').click();
    await expect(page.locator(".fd__io")).toContainText(
      lang === "en" ? "its branch wasn't taken" : "no se tomó su camino",
    );
  });
}
