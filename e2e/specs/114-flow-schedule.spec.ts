import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const L = {
  en: {
    newFlow: "New flow",
    name: "Flow name",
    addSchedule: "Add Schedule",
    addSave: "Add Save to table",
    table: "Table",
    newTable: "New table",
    newName: "Name of the new table",
    hourly: "Every hour",
    key: "Key",
    save: "Save",
    saved: "Saved. Turn it on to run it as drawn.",
    close: "Exit the editor",
    toggle: (n: string) => `Turn ${n} on or off`,
    runNow: "Run now",
    byYou: "Started by you",
    done: "Complete",
    next: /^Next: /,
    stop: "Stop run",
    look: "Needs a look",
    body: "Body it gets",
  },
  es: {
    newFlow: "Nuevo flow",
    name: "Nombre del flow",
    addSchedule: "Sumar Horario",
    addSave: "Sumar Guardar en la tabla",
    table: "Tabla",
    newTable: "Tabla nueva",
    newName: "Nombre de la tabla nueva",
    hourly: "Cada hora",
    key: "Clave",
    save: "Guardar",
    saved: "Guardado. Prendelo para que corra como está dibujado.",
    close: "Salir del editor",
    toggle: (n: string) => `Encender o apagar ${n}`,
    runNow: "Correr ahora",
    byYou: "La arrancaste vos",
    done: "Completa",
    next: /^Próxima: /,
    stop: "Detener ronda",
    look: "Para revisar",
    body: "Cuerpo que recibe",
  },
};

for (const lang of ["en", "es"] as const) {
  test(`a flow drawn on a schedule shows its next time, runs now and its run shows in the detail (${lang})`, async ({
    page,
  }) => {
    const l = L[lang];
    await rpc("setup.finish");
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Schedule ${lang}` })).project
      .id;
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    const name = `Northwind hourly ${lang}`;
    await open(page, `#view=flows&scope=${project}`);
    await page.getByRole("button", { name: l.newFlow }).first().click();
    const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: l.addSchedule }) });
    await editor.getByRole("textbox", { name: l.name }).fill(name);
    await editor.getByRole("button", { name: l.addSchedule }).click();
    await editor.getByRole("radio", { name: l.hourly }).click();
    await expect(editor.getByRole("textbox", { name: /cron/i })).toHaveValue("0 * * * *");
    await editor.getByRole("button", { name: l.addSave }).click();
    await editor.getByRole("combobox", { name: l.table, exact: true }).click();
    await page.getByRole("option", { name: l.newTable }).click();
    await editor.getByRole("textbox", { name: l.newName }).fill("ticks");
    await editor.getByRole("textbox", { name: l.key, exact: true }).fill("tick");
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText(l.saved);
    const { flows } = await rpc<Result<"flows.list">>("flows.list", { project });
    const flow = flows[0]?.id ?? "";
    expect((await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow })).draft?.nodes[0]).toMatchObject({
      kind: "schedule",
      cron: "0 * * * *",
    });
    await editor.getByRole("button", { name: l.close }).click();
    // On, it publishes and shows when it runs next; it has no address to POST to.
    await page.getByRole("switch", { name: l.toggle(name) }).click();
    await expect(page.locator(".fd__railnext")).toHaveText(l.next);
    const list = await rpc<Result<"flows.list">>("flows.list", { project });
    expect(list.schedules[flow]?.cron).toBe("0 * * * *");
    expect(Date.parse(list.schedules[flow]?.next_at ?? "") - Date.now()).toBeLessThanOrEqual(3600_000);
    // Run now: a schedule flow starts at once, with an empty event, and its run is the one shown.
    await page.getByRole("button", { name: l.runNow }).click();
    await expect(page.locator(".fd__runline")).toContainText(l.done);
    await expect(page.locator(".fd__runline")).toContainText(l.byYou);
    const [run] = (await rpc<Result<"flows.events">>("flows.events", { flow })).events;
    expect(run).toMatchObject({ source: "owner", state: "succeeded", scheduled_at: null });
    const { rows } = await rpc<Result<"flows.rows">>("flows.rows", { flow, table: "ticks" });
    expect(rows.map((r) => [r.key, r.value])).toEqual([["tick", {}]]);
  });

  test(`a webhook flow runs now with a sample body, and a run that is going can be stopped (${lang})`, async ({
    page,
  }) => {
    const l = L[lang];
    await rpc("setup.finish");
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Stop ${lang}` })).project.id;
    const flow = `stop-${lang}-${project}`;
    await rpc("flows.set", {
      id: flow,
      projectId: project,
      name: `Acme stop ${lang}`,
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    const draft = await rpc<Result<"flows.draft_save">>("flows.draft_save", {
      flow,
      expectedVersion: null,
      graph: {
        schemaVersion: 2,
        nodes: [
          { id: "start", kind: "webhook", label: "Webhook" },
          {
            id: "think",
            kind: "llm",
            label: "Think",
            model: "custom/fake-1",
            // The emulated model takes long on these, long enough to stop the run.
            prompt: "Take your time: summarize it.",
            input: { kind: "event", path: [] },
            maxOutputTokens: 100,
            timeoutMs: 60_000,
          },
          {
            id: "save",
            kind: "table_write",
            label: "Save",
            key: "summary",
            value: { kind: "node", node: "think", path: ["text"] },
          },
        ],
        edges: [
          { source: "start", target: "think" },
          { source: "think", target: "save" },
        ],
        layout: [],
      },
    });
    await rpc("flows.publish", { flow, expectedDraftVersion: draft.draftVersion, expectedPublishedRevision: null });
    const def = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0];
    await rpc("flows.set", { ...def, enabled: true });
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    await open(page, `#view=flows&flow=${flow}`);
    await page.getByRole("button", { name: l.runNow }).click();
    const body = page.getByRole("textbox", { name: l.body });
    await expect(body).toHaveValue("{}");
    await body.fill('{"text":"Two lamps"}');
    await page.getByRole("dialog").getByRole("button", { name: l.runNow }).click();
    await expect(page.locator(".fd__runline")).toContainText(l.byYou);
    await page.getByRole("button", { name: l.stop }).click();
    await page.getByRole("dialog").getByRole("button", { name: l.stop }).click();
    await expect(page.locator(".fd__runline")).toContainText(l.look);
    const [run] = (await rpc<Result<"flows.events">>("flows.events", { flow })).events;
    expect(run).toMatchObject({ source: "owner", state: "uncertain", cancelled_by_owner: true });
    const detail = await rpc<Result<"flows.run_get">>("flows.run_get", { flow, event: run?.event_id ?? "" });
    expect(detail.steps.map((s) => [s.node, s.state])).toEqual([
      ["start", "succeeded"],
      ["think", "uncertain"],
      ["save", "cancelled"],
    ]);
    // A second Run now offers the body it last received.
    await page.getByRole("button", { name: l.runNow }).click();
    await expect(body).toHaveValue(/"text": "Two lamps"/);
  });
}
