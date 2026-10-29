// Save to table and Read table around the project's tables: a save names a new table and a key from what arrived, a
// read later in the drawing is offered that table and gets the row back. On the way, a variable holds a secret picked
// from the list (a badge), the AI step shows the crew as cards, and every field of the side panel stands apart from
// what is behind it. FLOW_SHOTS=<folder> saves screenshots: dark and light, desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const L = {
  en: {
    newFlow: "New flow",
    name: "Flow name",
    add: (k: string) => `Add ${k}`,
    hook: "Incoming webhook",
    save: "Save to table",
    read: "Read table",
    vars: "Variables",
    check: "Check",
    ai: "AI model",
    table: "Table",
    newTable: "New table",
    newName: "Name of the new table",
    key: "Key",
    value: "Value",
    varName: "Name",
    agent: "Agent of the crew",
    task: "Instruction",
    del: "Delete step",
    pick: "Insert a value",
    saveBtn: "Save",
    saved: "Saved. Turn it on to run it as drawn.",
    close: "Exit the editor",
    toggle: (n: string) => `Turn ${n} on or off`,
    rows: "1 row",
  },
  es: {
    newFlow: "Nuevo flow",
    name: "Nombre del flow",
    add: (k: string) => `Sumar ${k}`,
    hook: "Webhook entrante",
    save: "Guardar en la tabla",
    read: "Leer tabla",
    vars: "Variables",
    check: "Condición",
    ai: "Modelo IA",
    table: "Tabla",
    newTable: "Tabla nueva",
    newName: "Nombre de la tabla nueva",
    key: "Clave",
    value: "Valor",
    varName: "Nombre",
    agent: "Agente del crew",
    task: "Instrucción",
    del: "Borrar paso",
    pick: "Insertar un valor",
    saveBtn: "Guardar",
    saved: "Guardado. Prendelo para que corra como está dibujado.",
    close: "Salir del editor",
    toggle: (n: string) => `Encender o apagar ${n}`,
    rows: "1 fila",
  },
};

const shots = process.env.FLOW_SHOTS;
/** Dark or light as the panel draws it: the mode is chosen once at start, so the look switches in place. */
async function setMode(page: Page, mode: "dark" | "light") {
  await page.evaluate((m) => {
    for (const el of document.querySelectorAll("[data-apx-mode]")) el.setAttribute("data-apx-mode", m);
  }, mode);
  // Fields ease into their new colors; wait until none is still moving.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}
/** Desktop and phone width, dark and light, when FLOW_SHOTS names a folder. */
async function shot(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  const size = page.viewportSize();
  for (const mode of ["dark", "light"] as const) {
    await setMode(page, mode);
    await page.screenshot({ path: path.join(shots, `${name}-${mode}.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(shots, `${name}-${mode}-phone.png`) });
    if (size) await page.setViewportSize(size);
  }
  await setMode(page, "dark");
}

/** Fields of the side panel whose fill and edge are both the same as what is behind them: they look missing. */
async function lostFields(side: Locator) {
  return side.evaluate((root) => {
    const behind = (el: Element | null): string => {
      for (let at = el; at; at = at.parentElement) {
        const bg = getComputedStyle(at).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      }
      return "";
    };
    const fields = root.querySelectorAll(
      ".apx-field:not(.fe-item__name), .apx-tfield__mirror, .apx-textarea:not(.apx-tfield__input)",
    );
    return [...fields].flatMap((el) => {
      const s = getComputedStyle(el);
      const edge = s.borderTopStyle !== "none" && s.borderTopWidth !== "0px" && s.borderTopColor !== "rgba(0, 0, 0, 0)";
      const fill = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== behind(el.parentElement);
      return edge || fill ? [] : [el.getAttribute("aria-label") ?? el.textContent ?? el.className];
    });
  });
}

for (const lang of ["en", "es"] as const) {
  test(`a save names a new table and a read later gets its row back (${lang})`, async ({ page }) => {
    const l = L[lang];
    await rpc("setup.finish");
    await rpc("secrets.set", { name: "flow_key", value: `sk-flow-e2e-tables-${lang}-0123456789` });
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Tables ${lang}` })).project.id;
    for (const [slug, name, role] of [
      ["max", "Max", "Marketing & growth"],
      ["finn", "Finn", "Billing & infra"],
    ])
      await rpc("agents.create", { project_id: project, slug: `${slug}-${lang}`, name, role });
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    await page.addInitScript(() => localStorage.setItem("apx.mode", "dark"));
    const name = `Leads ${lang}`;
    await open(page, `#view=flows&scope=${project}`);
    await page.getByRole("button", { name: l.newFlow }).first().click();
    const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: l.add(l.hook) }) });
    const side = editor.locator(".fe-card");
    await editor.getByRole("textbox", { name: l.name }).fill(name);
    await editor.getByRole("button", { name: l.add(l.hook) }).click();

    // The save names a table that does not exist yet; its key comes from what arrived.
    await editor.getByRole("button", { name: l.add(l.save) }).click();
    await editor.getByRole("combobox", { name: l.table }).click();
    await page.getByRole("option", { name: l.newTable }).click();
    await editor.getByRole("textbox", { name: l.newName }).fill("Leads Web");
    await expect(editor.getByRole("textbox", { name: l.newName })).toHaveValue("leads_web");
    await editor.getByRole("textbox", { name: l.key }).fill("$trigger.email");
    await expect(side.locator(".fe-row-preview code")).toHaveText("$trigger.email");
    await shot(page, `table-save-${lang}`);

    // A read after it is offered that table before it has any row, and reads the key back.
    await editor.getByRole("button", { name: l.add(l.read) }).click();
    await expect(editor.getByRole("combobox", { name: l.table })).toContainText("leads_web");
    const key = editor.getByRole("textbox", { name: l.key });
    await key.click();
    await key.pressSequentially("$tr");
    await page.getByRole("option", { name: /\$trigger\.email/ }).click();
    await expect(key).toHaveValue("$trigger.email");
    await shot(page, `table-read-${lang}`);

    // A variable holds a secret picked from the list; it reads as a secret badge, and nothing in the panel vanishes.
    await editor.getByRole("button", { name: l.add(l.vars) }).click();
    await editor.getByRole("textbox", { name: l.varName, exact: true }).fill("token");
    const value = editor.getByRole("textbox", { name: l.value, exact: true });
    expect(await lostFields(side)).toEqual([]);
    await setMode(page, "light");
    expect(await lostFields(side)).toEqual([]);
    await setMode(page, "dark");
    await value.click();
    await value.pressSequentially("secret://");
    await page.getByRole("option", { name: /flow_key/ }).click();
    await expect(value).toHaveValue("secret://flow_key");
    await expect(side.locator(".apx-tfield__chip.is-secret", { hasText: "secret://flow_key" })).toBeVisible();
    await shot(page, `vars-secret-${lang}`);
    await value.click();
    await editor.getByRole("button", { name: l.pick }).first().click();
    await shot(page, `picker-${lang}`);
    await value.press("Escape");

    // A check and the AI step, as the panel shows them, then out of the drawing again.
    await editor.getByRole("button", { name: l.add(l.check) }).click();
    expect(await lostFields(side)).toEqual([]);
    await shot(page, `check-${lang}`);
    await editor.getByRole("button", { name: l.del }).click();
    await editor.locator('.react-flow__node[data-id="vars-1"]').click();
    await editor.getByRole("button", { name: l.add(l.ai) }).click();
    const crew = editor.getByRole("radiogroup", { name: l.agent });
    await expect(crew.getByRole("radio")).toHaveCount(3);
    await crew.getByRole("radio", { name: /Max/ }).click();
    await expect(crew.getByRole("radio", { name: /Max/ })).toBeChecked();
    await editor.getByRole("textbox", { name: l.task }).fill("Write to $trigger.name, short.");
    expect(await lostFields(side)).toEqual([]);
    await shot(page, `ai-crew-${lang}`);
    await editor.getByRole("button", { name: l.del }).click();

    await editor.getByRole("button", { name: l.saveBtn, exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText(l.saved);
    await editor.getByRole("button", { name: l.close }).click();
    await page.getByRole("switch", { name: l.toggle(name) }).click();
    await expect(page.getByRole("switch", { name: l.toggle(name) })).toBeChecked();

    const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.id ?? "";
    const credential = await rpc<Result<"public_routes.rotate">>("public_routes.rotate", { path: `/flows/${flow}` });
    const { value: token } = await rpc<Result<"secrets.reveal">>("secrets.reveal", {
      name: credential.secret_ref.slice(9),
    });
    const { port } = await rpc<Result<"webhooks.get">>("webhooks.get", {});
    const lead = { email: `sam-${lang}@northwind.example`, name: "Sam" };
    const sent = await fetch(`http://127.0.0.1:${port}/flows/${flow}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: `lead-${lang}`, data: lead }),
    });
    expect(sent.status).toBe(202);
    await expect
      .poll(async () => (await rpc<Result<"flows.events">>("flows.events", { flow })).events.map((e) => e.state))
      .toEqual(["succeeded"]);
    const run = await rpc<Result<"flows.run_get">>("flows.run_get", { flow, event: `lead-${lang}` });
    expect(JSON.parse(run.steps.find((s) => s.node === "table_read-1")?.output ?? "null").row).toEqual(lead);
    const { tables } = await rpc<Result<"flows.tables">>("flows.tables", { project });
    expect(tables.map((t) => [t.name, t.rows])).toEqual([["leads_web", 1]]);

    // The editor now lists the table with its rows.
    await open(page, `#view=flows&flow=${flow}&edit=1`);
    await editor.locator('.react-flow__node[data-id="table_read-1"]').click();
    await editor.getByRole("combobox", { name: l.table }).click();
    await expect(page.getByRole("option", { name: new RegExp(`leads_web.*${l.rows}`) })).toBeVisible();
  });
}
