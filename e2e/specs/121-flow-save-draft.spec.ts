// Save draft in the Flow editor keeps the drawing as it is, steps not finished yet included, and never publishes: what
// runs stays as it was; Save then names the step to finish. The leave prompt saves a draft too. A Flow made by an
// agent shows its draft in the list and on its page, marked as a draft, never the table-only placeholder it belongs
// to. FLOW_SHOTS=<folder> saves the top bar after a draft save, the list and the page, at desktop and phone width.
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

type Graph = NonNullable<Result<"flows.graph_get">["published"]>;
const intake: Graph = {
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
  ],
  edges: [{ source: "hook", target: "save" }],
  layout: [
    { node: "hook", x: 0, y: 0 },
    { node: "save", x: 280, y: 0 },
  ],
};

/** A project with its leads table and a Flow there whose drawing is published (revision 1), on or off. */
async function published(name: string, on: boolean) {
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name })).project.id;
  await rpc("tables.create", { project, name: "leads" });
  const made = await rpc<Result<"flows.create">>("flows.create", { project, name: "Lead intake", graph: intake });
  const flow = made.flow.id;
  await rpc("flows.publish", {
    flow,
    expectedDraftVersion: made.document.draftVersion,
    expectedPublishedRevision: null,
  });
  if (on) await rpc("flows.set", { ...made.flow, enabled: true });
  return { project, flow };
}
const docOf = (flow: string) => rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });

for (const phone of [false, true]) {
  const at = phone ? "phone" : "desktop";
  test(`Save draft keeps a step not finished yet without publishing; Save names it (${at})`, async ({ page }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await rpc("setup.finish", {});
    const { project, flow } = await published(`Acme draft ${at}`, false);
    await open(page, `#view=flows&scope=${project}&flow=${flow}&edit=1`);
    const editor = page.locator(".fe");
    const canvas = editor.locator(".fe-canvas > .fc");
    await expect(canvas.locator(".react-flow__node")).toHaveCount(2);

    // A JavaScript step with no code yet.
    if (phone) await editor.getByRole("button", { name: "Sumar un paso" }).click();
    await editor.getByRole("button", { name: "Sumar JavaScript" }).click();
    await editor.getByRole("textbox", { name: "Código" }).fill("");
    await editor.getByRole("button", { name: "Guardar borrador" }).click();
    // Kept as it is, and it says what is left before it can run.
    await expect(editor.getByRole("status")).toHaveText(
      "Borrador guardado. Para que corra: «JavaScript» no está completo: completá lo que le falta.",
    );
    let doc = await docOf(flow);
    expect(doc.draft?.nodes.find((n) => n.kind === "js")).toMatchObject({ code: "" });
    expect(doc.publishedRevision).toBe(1);
    expect(doc.published).toEqual(intake);
    await shot(page, `editor-draft-saved-${at}`);

    // Save asks for the step first, and what runs stays revision 1.
    await editor.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(editor.getByRole("alert")).toHaveText("Completá «JavaScript».");
    doc = await docOf(flow);
    expect(doc.publishedRevision).toBe(1);

    // Turning it on from the list publishes nothing unfinished: its editor opens on it.
    await editor.getByRole("button", { name: "Salir del editor" }).click();
    await open(page, `#view=flows&scope=${project}`);
    const row = page.locator(".flowrow").filter({ hasText: "Lead intake" });
    await expect(row.locator(".flowrow__open")).toContainText(phone ? "Lead intake" : "Borrador");
    await row.getByRole("switch", { name: "Encender o apagar Lead intake" }).click();
    await expect(
      page.getByText("«JavaScript» no está completo: terminalo en el editor y después prendé el flow."),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`flow=${flow}.*edit=1`));
    expect((await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.enabled).toBe(false);
    expect((await docOf(flow)).publishedRevision).toBe(1);
  });
}

test("on a Flow that is on, Save draft and the leave prompt keep what runs as it is", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project, flow } = await published("Acme running", true);
  await open(page, `#view=flows&scope=${project}&flow=${flow}&edit=1`);
  const editor = page.locator(".fe");
  await expect(editor.locator(".fe-canvas > .fc .react-flow__node")).toHaveCount(2);
  await editor.getByRole("button", { name: "Sumar JavaScript" }).click();
  await editor.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(
    editor.getByRole("status").filter({ hasText: "Borrador guardado. Lo que corre no cambia." }),
  ).toBeVisible();
  await shot(page, "editor-draft-saved-on-desktop");
  let doc = await docOf(flow);
  expect(doc.publishedRevision).toBe(1);
  expect(doc.published).toEqual(intake);
  expect(doc.draft?.nodes).toHaveLength(3);
  const saved = doc.draftVersion;

  // An unsaved change, then Exit: the prompt saves it as a draft and closes.
  await editor.getByRole("button", { name: "Sumar JavaScript" }).click();
  await editor.getByRole("button", { name: "Salir del editor" }).click();
  const prompt = page.getByRole("dialog", { name: "¿Salir sin guardar?" });
  await expect(prompt).toContainText("Guardalos como borrador para volver a ellos, o salí y se pierden.");
  await shot(page, "leave-prompt-desktop");
  await prompt.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(editor).toBeHidden();
  doc = await docOf(flow);
  expect(doc.draftVersion).toBeGreaterThan(saved ?? 0);
  expect(doc.draft?.nodes).toHaveLength(4);
  expect(doc.publishedRevision).toBe(1);

  // The page shows the draft, and what runs on request.
  await open(page, `#view=flows&scope=${project}&flow=${flow}`);
  const head = page.locator(".fd__head");
  await expect(head).toContainText("4 pasos");
  await expect(page.locator(".fd__version")).toHaveText("Borrador");
  await shot(page, "page-draft-and-runs-desktop");
  await page.getByRole("radio", { name: "Lo que corre" }).click();
  await expect(head).toContainText("2 pasos");
  await expect(page.locator(".fd__version")).toHaveText("Versión actual");
});

test("a Flow an agent made shows its draft steps in the list and on its page, never its placeholder", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Acme agent" })).project.id;
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: "Flows" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill(`draw a flow in ${project}`);
  await page.keyboard.press("Enter");
  await expect(page.locator(".flowcard")).toContainText("Borrador");
  const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.id ?? "";
  // The agent's drawing grows: a code step and an AI step, still the agent's draft.
  const doc = await docOf(flow);
  const draft = doc.draft as Graph;
  await rpc("flows.draft_save", {
    flow,
    expectedVersion: doc.draftVersion,
    unreviewed: true,
    graph: {
      ...draft,
      nodes: [
        ...draft.nodes,
        { id: "clean", kind: "js", label: "Clean it", code: "", input: { kind: "event", path: [] }, timeoutMs: 2000 },
        {
          id: "think",
          kind: "agent",
          label: "Sum it up",
          agent: "superagent",
          prompt: "",
          input: { kind: "event", path: [] },
        },
      ],
      edges: [...draft.edges, { source: "save", target: "clean" }, { source: "clean", target: "think" }],
    },
  });

  await open(page, `#view=flows&scope=${project}`);
  const row = page.locator(".flowrow").filter({ hasText: "New leads" });
  // The draft's save, code and AI steps, not the placeholder's lone save.
  await expect(row.locator(".flowrow__chips .apx-flowstep__tile")).toHaveCount(3);
  await expect(row.locator(".flowrow__chips")).toContainText("Borrador");
  await expect(row.locator(".flowrow__model")).toContainText("Con IA · 1");
  await shot(page, "list-agent-draft-desktop");

  await row.locator(".flowrow__open").click();
  await expect(page.locator(".fd__head")).toContainText("4 pasos");
  await expect(page.locator(".fd__version")).toHaveText("Borrador");
  // Nothing drawn runs yet: there is no "What runs" to switch to.
  await expect(page.getByRole("radio", { name: "Lo que corre" })).toHaveCount(0);
  await expect(page.locator(".fd__canvas .react-flow__node")).toHaveCount(4);
  await shot(page, "page-agent-draft-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".fd__version")).toHaveText("Borrador");
  await shot(page, "page-agent-draft-phone");
});
