// Testing a Flow with a real event from its editor (DECISIONS.md#d-178): the webhook card shows its two addresses, the
// owner listens, a POST to the test address runs the saved drawing while the Flow is off, the steps light up and the
// log fills, the canvas can't change meanwhile, and the Flow's page lists the run as a test. Renaming the address
// moves it: the old one stops answering. FLOW_SHOTS=<folder> saves the card, the editor listening, mid-run and done,
// and the Flow's page, at desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.FLOW_SHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}
const HOST = "https://apx.example.com";

type Graph = NonNullable<Result<"flows.graph_get">["published"]>;
const leads = (slow: boolean): Graph => ({
  schemaVersion: 2,
  nodes: [
    { id: "hook", kind: "webhook", label: "New lead" },
    {
      id: "save",
      kind: "table_write",
      label: "Save the lead",
      table: "leads",
      key: "latest",
      value: { kind: "event", path: [] },
    },
    ...(slow
      ? [
          {
            id: "wait",
            kind: "cmd" as const,
            label: "Wait a moment",
            command: "sleep 3",
            env: [],
            stdin: "",
            timeoutMs: 20_000,
            continueOnError: false,
          },
        ]
      : []),
  ],
  edges: [{ source: "hook", target: "save" }, ...(slow ? [{ source: "save", target: "wait" }] : [])],
  layout: [
    { node: "hook", x: 0, y: 0 },
    { node: "save", x: 280, y: 0 },
    ...(slow ? [{ node: "wait", x: 560, y: 0 }] : []),
  ],
});

/** A project with a leads table and a Flow drawn there, off and never published. */
async function drawn(project: string, name: string, slow: boolean) {
  await rpc("tables.create", { project, name: "leads" });
  return rpc<Result<"flows.create">>("flows.create", { project, name, graph: leads(slow) });
}
const hooks = async () => (await rpc<Result<"webhooks.get">>("webhooks.get", {})).port;
const post = async (address: string, data: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${await hooks()}${address}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ id: "e2e", data }),
  });

/** Whether a step sits wholly in the canvas above the log and the floating test controls. */
async function clearOfLog(page: Page, id: string) {
  const step = await page.locator(`.fe .react-flow__node[data-id="${id}"]`).boundingBox();
  const log = await page.locator(".fe-log").boundingBox();
  const dock = await page.locator(".fe-dock").boundingBox();
  const canvas = await page.locator(".fe-canvas").boundingBox();
  if (!step || !log || !dock || !canvas) return false;
  return step.y >= canvas.y && step.y + step.height <= Math.min(log.y, dock.y) - 4 && dock.y + dock.height <= log.y + 1;
}

test.afterEach(async () => {
  await rpc("webhooks.set", { mode: "off" });
});

for (const phone of [false, true]) {
  const at = phone ? "phone" : "desktop";
  test(`a test event runs the saved drawing live, read-only, and the Flow's page lists it as a test (${at})`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await rpc("setup.finish", {});
    await rpc("webhooks.set", { mode: "custom", url: HOST });
    const project = (await rpc<{ project: { id: string } }>("projects.create", { name: `Northwind test ${at}` }))
      .project.id;
    const made = await drawn(project, `Leads from the form ${at}`, true);
    const route = made.flow.path ?? "";
    expect(route).toBe(`leads-from-the-form-${at}`);
    await open(page, `#view=flows&scope=${project}&flow=${made.flow.id}&edit=1`);
    const editor = page.locator(".fe");
    const node = (id: string) => editor.locator(`.react-flow__node[data-id="${id}"]`);
    await expect(node("hook")).toContainText(`POST /flows/${route}`);

    // The webhook's card: one address on the public host, production or test, and one way to copy it.
    await node("hook").click();
    const card = editor.locator(".fe-card");
    await expect(card).toContainText(`${HOST}/flows/${route}`);
    await expect(card.getByRole("button", { name: /^Copiar la dirección/ })).toHaveCount(1);
    await card.getByRole("radio", { name: "Prueba" }).click();
    await expect(card).toContainText(`${HOST}/flows/test/${route}`);
    await expect(card.getByRole("button", { name: "Copiar la dirección de prueba" })).toBeVisible();
    await shot(page, `webhook-card-${at}`);
    await card.getByRole("button", { name: "Cerrar" }).first().click();

    // Listening asks first what the test will do for real (a command), then waits at the test address.
    await editor.getByRole("button", { name: "Escuchar un evento de prueba" }).click();
    await page.getByRole("button", { name: "Permitir" }).click();
    const strip = editor.locator(".fe-dock");
    await expect(strip).toContainText("Escuchando un evento…");
    await expect(strip).toContainText(`${HOST}/flows/test/${route}`);
    await expect(editor.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
    await expect(editor.locator(".fe-log")).toContainText("Esperando el evento…");
    // The view fits again in what the log leaves visible, and the minimap gives way to it.
    await expect.poll(() => clearOfLog(page, "hook")).toBe(true);
    await expect(editor.locator(".fc-minimap")).toBeHidden();
    await shot(page, `editor-listening-${at}`);

    // Nothing is published and the Flow is off; the POST runs what was drawn.
    const sent = await post(`/flows/test/${route}`, { name: "Ada", email: "ada@example.com" });
    expect(sent.status).toBe(202);
    await expect(strip).toContainText("Corriendo la prueba…");
    await expect(node("save")).toContainText("ok");
    const log = editor.locator(".fe-log");
    await expect(log).toContainText(`Llegó un evento · POST /flows/test/${route}`);
    await expect(log).toContainText('"name": "Ada"');
    await expect(log).toContainText("«Save the lead» terminó");
    await expect(log).toContainText("«Wait a moment» empezó");
    // The canvas only shows while it runs: a step's card has no settings to change.
    if (!phone) await expect(editor.getByRole("button", { name: "Sumar JavaScript" })).toBeDisabled();
    await node("save").click();
    await expect(editor.locator(".fe-tstep")).toContainText("ada@example.com");
    await expect(editor.locator(".fe-card").getByRole("textbox")).toHaveCount(0);
    await shot(page, `editor-running-${at}`);
    await expect(strip).toContainText("La prueba terminó.", { timeout: 20_000 });
    await expect(log).toContainText("La ronda terminó.");
    await shot(page, `editor-done-${at}`);
    const doc = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow: made.flow.id });
    expect(doc.publishedRevision).toBeNull();
    const rows = await rpc<Result<"tables.get">>("tables.get", { project, table: "leads", limit: 5 });
    expect(rows.rows[0]?.value).toEqual({ name: "Ada", email: "ada@example.com" });

    // Back to editing, out, and the Flow's page lists the run as a test with the same log.
    await strip.getByRole("button", { name: "Volver a editar" }).click();
    await expect(editor.locator(".fe-log")).toHaveCount(0);
    await editor.getByRole("button", { name: "Salir del editor" }).click();
    await open(page, `#view=flows&scope=${project}&flow=${made.flow.id}`);
    const run = page.locator(".fd__run").first();
    await expect(run).toContainText("Prueba");
    await run.click();
    await expect(page.locator(".fd__runline")).toContainText("Prueba");
    await page.locator(".fd__panel").getByRole("radio", { name: "Ronda completa" }).click();
    await expect(page.locator(".fd__runlog")).toContainText("«Save the lead» terminó");
    await shot(page, `flow-page-test-run-${at}`);
  });
}

test("the test address answers nothing unless the owner listens, and a renamed address stops the old one", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  await rpc("webhooks.set", { mode: "custom", url: HOST });
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Northwind rename" })).project.id;
  const made = await drawn(project, "Orders in", false);
  const route = made.flow.path ?? "";
  // Not listening: refused, and nothing ran.
  expect((await post(`/flows/test/${route}`, { n: 1 })).status).toBe(404);
  expect((await rpc<Result<"flows.events">>("flows.events", { flow: made.flow.id })).events).toHaveLength(0);
  await rpc("flows.publish", {
    flow: made.flow.id,
    expectedDraftVersion: made.document.draftVersion,
    expectedPublishedRevision: null,
  });
  await rpc("flows.set", { ...made.flow, enabled: true });
  const credential = await rpc<Result<"public_routes.rotate">>("public_routes.rotate", { path: `/flows/${route}` });
  const { value: token } = await rpc<Result<"secrets.reveal">>("secrets.reveal", {
    name: credential.secret_ref.slice(9),
  });
  const auth = { authorization: `Bearer ${token}` };
  expect((await post(`/flows/${route}`, { n: 1 }, auth)).status).toBe(202);

  await open(page, `#view=flows&scope=${project}&flow=${made.flow.id}&edit=1`);
  const editor = page.locator(".fe");
  await editor.locator('.react-flow__node[data-id="hook"]').click();
  const card = editor.locator(".fe-card");
  // The end of the address is written in place; Enter takes it.
  const end = card.getByRole("textbox", { name: "Final de la dirección" });
  await end.fill("orders-renamed");
  await end.press("Enter");
  await expect(page.getByRole("dialog", { name: "¿Cambiar la dirección?" })).toContainText(
    "La dirección anterior deja de funcionar",
  );
  await page.getByRole("button", { name: "Cambiarla" }).click();
  await expect(card).toContainText(`${HOST}/flows/orders-renamed`);
  expect((await post(`/flows/${route}`, { n: 2 }, auth)).status).toBe(404);
  expect((await post("/flows/orders-renamed", { n: 3 }, auth)).status).toBe(202);
});
