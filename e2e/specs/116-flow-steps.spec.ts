// A flow drawn with the blocks that run without a model: variables, a check with cases, JavaScript, SQL on the
// project's own database and a command in its folder. Everything runs in the sandbox core; the database is a file in
// the test project's folder.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const L = {
  en: {
    newFlow: "New flow",
    name: "Flow name",
    add: (k: string) => `Add ${k}`,
    hook: "Incoming webhook",
    vars: "Variables",
    check: "Check",
    js: "JavaScript",
    sql: "SQL",
    cmd: "Cmd",
    varName: "Name",
    formula: "Formula",
    caseName: "Name of this case",
    code: "Code",
    database: "Database",
    readOnly: "Read only",
    query: "Query",
    values: "Values",
    command: "Command",
    env: "Variables",
    save: "Save",
    saved: "Saved. Turn it on to run it as drawn.",
    close: "Exit the editor",
    toggle: (n: string) => `Turn ${n} on or off`,
    allowTitle: "Let this flow act for you?",
    run: "Run this command in",
    write: "Change the database data/shop.db",
    allow: "Allow",
    changed: "Rows changed: 1",
    exit: "Exit code 0",
    big: "Big",
  },
  es: {
    newFlow: "Nuevo flow",
    name: "Nombre del flow",
    add: (k: string) => `Sumar ${k}`,
    hook: "Webhook entrante",
    vars: "Variables",
    check: "Condición",
    js: "JavaScript",
    sql: "SQL",
    cmd: "Cmd",
    varName: "Nombre",
    formula: "Fórmula",
    caseName: "Nombre de este caso",
    code: "Código",
    database: "Base de datos",
    readOnly: "Solo lectura",
    query: "Consulta",
    values: "Valores",
    command: "Comando",
    env: "Variables",
    save: "Guardar",
    saved: "Guardado. Prendelo para que corra como está dibujado.",
    close: "Salir del editor",
    toggle: (n: string) => `Encender o apagar ${n}`,
    allowTitle: "¿Dejás que este flow actúe por vos?",
    run: "Correr este comando en",
    write: "Cambiar la base de datos data/shop.db",
    allow: "Permitir",
    changed: "Filas cambiadas: 1",
    exit: "Código de salida 0",
    big: "Grande",
  },
};

for (const lang of ["en", "es"] as const) {
  test(`variables → a check with cases → JavaScript and SQL, or a command, run as drawn (${lang})`, async ({
    page,
  }) => {
    const l = L[lang];
    await rpc("setup.finish");
    const created = await rpc<{ project: { id: string; path?: string } }>("projects.create", { name: `Steps ${lang}` });
    const project = created.project.id;
    const folder = created.project.path ?? "";
    fs.mkdirSync(path.join(folder, "data"), { recursive: true });
    const file = path.join(folder, "data", "shop.db");
    new DatabaseSync(file).exec("CREATE TABLE orders (email TEXT, total REAL, tier TEXT)");
    await page.addInitScript((language) => {
      localStorage.setItem("apx.prefs", JSON.stringify({ language }));
    }, lang);
    const name = `Orders ${lang}`;
    await open(page, `#view=flows&scope=${project}`);
    await page.getByRole("button", { name: l.newFlow }).first().click();
    const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: l.add(l.hook) }) });
    await editor.getByRole("textbox", { name: l.name }).fill(name);

    // Each step goes after the one chosen; out of a check, by its first free way out.
    await editor.getByRole("button", { name: l.add(l.hook) }).click();
    await editor.getByRole("button", { name: l.add(l.vars) }).click();
    await editor.getByRole("textbox", { name: l.varName, exact: true }).fill("total");
    await editor.getByRole("radio", { name: l.formula }).click();
    await editor.getByRole("textbox", { name: l.formula }).fill("$trigger.price * $trigger.qty");
    await editor.getByRole("button", { name: l.add(l.check) }).click();
    await editor.getByRole("textbox", { name: l.caseName }).fill(l.big);
    // A case starts as a comparison; the formula is its other tab, in the same place.
    await editor.getByRole("radio", { name: l.formula }).click();
    await editor.getByRole("textbox", { name: l.formula }).fill("$vars.total >= 100");
    await editor.getByRole("button", { name: l.add(l.js) }).click();
    await editor
      .getByRole("textbox", { name: l.code })
      .fill('return { tier: vars.total >= 500 ? "gold" : "silver", email: input.email };');
    await editor.getByRole("button", { name: l.add(l.sql) }).click();
    await editor.getByRole("textbox", { name: l.database }).fill("data/shop.db");
    await editor.getByRole("switch", { name: l.readOnly }).click();
    await editor
      .getByRole("textbox", { name: l.query })
      .fill("INSERT INTO orders (email, total, tier) VALUES (:email, :total, :tier)");
    await editor
      .getByRole("textbox", { name: l.values })
      .fill("email: $trigger.email\ntotal: $vars.total\ntier: $steps.js-1.tier");
    // Back to the check, out of view by now, from the list of steps: the command goes on by its other way out.
    await editor.locator(".fe-order__row", { hasText: l.check }).click();
    await editor.getByRole("button", { name: l.add(l.cmd) }).click();
    await editor.getByRole("textbox", { name: l.command }).fill('printf "small order from %s" "$EMAIL"');
    await editor.getByRole("textbox", { name: l.env }).fill("EMAIL=$trigger.email");
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText(l.saved);
    await editor.getByRole("button", { name: l.close }).click();

    // Turning it on asks first, naming the command and the database it changes.
    await page.getByRole("switch", { name: l.toggle(name) }).click();
    const ask = page.getByRole("dialog", { name: l.allowTitle });
    await expect(ask).toContainText(l.run);
    await expect(ask).toContainText('printf "small order from %s" "$EMAIL"');
    await expect(ask).toContainText(l.write);
    await ask.getByRole("button", { name: l.allow }).click();
    await expect(page.getByRole("switch", { name: l.toggle(name) })).toBeChecked();
    const listed = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0];
    const flow = listed?.id ?? "";
    const route = listed?.path ?? "";
    const graph = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
    expect(graph.published?.nodes.map((n) => n.kind)).toEqual(["webhook", "vars", "condition", "js", "sql", "cmd"]);
    expect(graph.published?.edges.filter((e) => e.source === "condition-1").map((e) => [e.target, e.when])).toEqual([
      ["js-1", "yes"],
      ["cmd-1", "no"],
    ]);

    // Two orders come in through the flow's address: a big one and a small one whose email tries to break out.
    const credential = await rpc<Result<"public_routes.rotate">>("public_routes.rotate", { path: `/flows/${route}` });
    const { value: token } = await rpc<Result<"secrets.reveal">>("secrets.reveal", {
      name: credential.secret_ref.slice(9),
    });
    const { port } = await rpc<Result<"webhooks.get">>("webhooks.get", {});
    const send = (id: string, data: unknown) =>
      fetch(`http://127.0.0.1:${port}/flows/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, data }),
      });
    const big = `lu-${lang}@northwind.example`;
    expect((await send(`big-${lang}`, { email: big, price: 60, qty: 4 })).status).toBe(202);
    const evil = `$(touch pwned-${lang}); x'); DROP TABLE orders; --`;
    expect((await send(`small-${lang}`, { email: evil, price: 1, qty: 1 })).status).toBe(202);
    await expect
      .poll(async () => (await rpc<Result<"flows.events">>("flows.events", { flow })).events.map((e) => e.state))
      .toEqual(["succeeded", "succeeded"]);
    const rows = new DatabaseSync(file, { readOnly: true }).prepare("SELECT * FROM orders").all();
    expect(rows.map((r) => ({ ...r }))).toEqual([{ email: big, total: 240, tier: "silver" }]);
    const small = await rpc<Result<"flows.run_get">>("flows.run_get", { flow, event: `small-${lang}` });
    const out = JSON.parse(small.steps.find((s) => s.node === "cmd-1")?.output ?? "null");
    expect(out.stdout).toBe(`small order from ${evil}`);
    expect(fs.existsSync(path.join(folder, `pwned-${lang}`))).toBe(false);

    // The detail shows what each step did: the latest run took the command's way, the first wrote its row.
    await page.reload();
    await page.locator('.react-flow__node[data-id="cmd-1"]').click();
    await expect(page.getByText(l.exit)).toBeVisible();
    await page.locator(".fd__run").last().click();
    await page.locator('.react-flow__node[data-id="sql-1"]').click();
    await expect(page.getByText(l.changed)).toBeVisible();
  });
}
