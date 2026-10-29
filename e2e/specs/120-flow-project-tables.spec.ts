// A project's tables on their own: a Read step makes a table and a column with no save anywhere and a run reads it
// empty; the Flows screen's Tables adds a column and a row that a Flow run then reads. FLOW_SHOTS=<folder> saves
// screenshots at desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.FLOW_SHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  const size = page.viewportSize();
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shots, `${name}-phone.png`) });
  if (size) await page.setViewportSize(size);
}

/** Runs a published, enabled Flow by hand with this body and waits for it to end. */
async function runNow(flow: string, data: unknown) {
  await rpc("flows.run_now", { flow, data });
  await expect
    .poll(async () => (await rpc<Result<"flows.events">>("flows.events", { flow })).events[0]?.state)
    .toMatch(/succeeded|failed/);
  const event = (await rpc<Result<"flows.events">>("flows.events", { flow })).events[0];
  expect(event?.state).toBe("succeeded");
  return rpc<Result<"flows.run_get">>("flows.run_get", { flow, event: event?.event_id ?? "" });
}
const outputOf = (run: Result<"flows.run_get">, node: string) =>
  JSON.parse(run.steps.find((s) => s.node === node)?.output ?? "null");

test("a read makes its table and a column with no save in the Flow, and a run reads it empty", async ({ page }) => {
  await rpc("setup.finish");
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Tables from read" })).project.id;
  await page.addInitScript(() => localStorage.setItem("apx.prefs", JSON.stringify({ language: "en" })));
  await open(page, `#view=flows&scope=${project}`);
  await page.getByRole("button", { name: "New flow" }).first().click();
  const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Add Incoming webhook" }) });
  await editor.getByRole("textbox", { name: "Flow name" }).fill("Contacts lookup");
  await editor.getByRole("button", { name: "Add Incoming webhook" }).click();
  await editor.getByRole("button", { name: "Add Read table" }).click();

  // No table yet: the read makes one on the spot, never "save first".
  await editor.getByRole("combobox", { name: "Table", exact: true }).click();
  await page.getByRole("option", { name: "New table" }).click();
  await editor.getByRole("textbox", { name: "Name of the new table" }).fill("Contacts");
  await shot(page, "read-new-table");
  await editor.getByRole("button", { name: "Add", exact: true }).click();
  await expect(editor.getByRole("combobox", { name: "Table", exact: true })).toContainText("contacts");
  await editor.getByRole("button", { name: "New column" }).click();
  await editor.getByRole("textbox", { name: "Name of the new column" }).fill("email");
  await shot(page, "read-new-column-name");
  await editor.getByRole("button", { name: "Add", exact: true }).click();
  await expect(editor.locator(".ft-chips")).toContainText("$steps.table_read-1.email");
  await editor.getByRole("textbox", { name: "Key", exact: true }).fill("$trigger.id");
  await shot(page, "read-new-column");
  const tables = await rpc<Result<"tables.list">>("tables.list", { project });
  expect(tables.tables.map((t) => [t.name, t.columns, t.rows])).toEqual([["contacts", ["email"], 0]]);

  // Save to table on the same drawing: by column, with the column it just made.
  await editor.getByRole("button", { name: "Add Save to table" }).click();
  await editor.getByRole("combobox", { name: "Table", exact: true }).click();
  await page.getByRole("option", { name: /^contacts/ }).click();
  await expect(editor.getByRole("radio", { name: "By column" })).toBeChecked();
  await expect(editor.getByRole("textbox", { name: "email", exact: true })).toBeVisible();
  await shot(page, "save-by-column");
  await editor.getByRole("button", { name: "Delete step" }).click();

  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("Saved. Turn it on to run it as drawn.");
  await editor.getByRole("button", { name: "Exit the editor" }).click();
  await page.getByRole("switch", { name: "Turn Contacts lookup on or off" }).click();
  await expect(page.getByRole("switch", { name: "Turn Contacts lookup on or off" })).toBeChecked();
  const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.id ?? "";
  const run = await runNow(flow, { id: "nobody" });
  expect(outputOf(run, "table_read-1")).toEqual({ email: null, rows: {}, row: null });
});

test("Tables adds a column and a row, and a Flow run reads that row", async ({ page }) => {
  await rpc("setup.finish");
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Tables view" })).project.id;
  await page.addInitScript(() => localStorage.setItem("apx.prefs", JSON.stringify({ language: "en" })));
  await open(page, `#view=flows&scope=${project}`);
  await page.getByRole("radio", { name: "Tables" }).click();
  await expect(page.getByText("No tables yet")).toBeVisible();
  await page.getByRole("button", { name: "New table" }).click();
  await page.getByRole("textbox", { name: "Name of the new table" }).fill("deals");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".ft-detail__title h2")).toHaveText("deals");
  await page.getByRole("button", { name: "New column" }).click();
  await page.getByRole("textbox", { name: "Name of the new column" }).fill("stage");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: /stage/ })).toBeVisible();

  await page.getByRole("button", { name: "Add row" }).click();
  const row = page.getByRole("dialog", { name: "Add row" });
  await row.getByRole("textbox", { name: "Key" }).fill("acme");
  await row.getByRole("textbox", { name: "stage" }).fill("won");
  await row.getByRole("button", { name: "Save row" }).click();
  await expect(page.getByRole("button", { name: "Edit the row acme" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "won" })).toBeVisible();
  await shot(page, "tables-view");
  // The link survives a reload: the table stays open.
  await expect(page).toHaveURL(/tab=tables&table=deals/);

  // A Flow made elsewhere reads it by key; later steps get the column.
  const id = `deal-check-${Date.now()}`;
  await rpc("flows.set", {
    id,
    projectId: project,
    name: "Deal check",
    enabled: false,
    predicates: [],
    tableKey: "latest",
    action: { kind: "none" },
  });
  const graph = {
    schemaVersion: 2,
    nodes: [
      { id: "start", kind: "webhook", label: "Webhook" },
      { id: "read", kind: "table_read", label: "Read", table: "deals", keys: ["$trigger.company"] },
    ],
    edges: [{ source: "start", target: "read" }],
    layout: [],
  };
  const draft = await rpc<Result<"flows.draft_save">>("flows.draft_save", { flow: id, expectedVersion: null, graph });
  await rpc("flows.publish", {
    flow: id,
    expectedDraftVersion: draft.draftVersion,
    expectedPublishedRevision: null,
    outward: [],
  });
  const def = (await rpc<Result<"flows.list">>("flows.list", { project })).flows.find((f) => f.id === id);
  await rpc("flows.set", { ...def, enabled: true });
  const run = await runNow(id, { company: "acme" });
  expect(outputOf(run, "read")).toMatchObject({ stage: "won", row: { stage: "won" } });

  // Deleting a column asks first.
  await page.getByRole("button", { name: "Column stage" }).click();
  await page.getByRole("menuitem", { name: "Delete column" }).click();
  await expect(page.getByRole("dialog", { name: "Delete the column stage?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("columnheader", { name: /stage/ })).toBeVisible();
});
