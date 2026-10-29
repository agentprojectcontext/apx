// The step fields the owner fills as one pattern (DECISIONS.md#d-180): a check of two comparisons joined by "and"
// routes a Simulate run, a read brings the columns it ticks, a save that leaves a required column empty is unfinished,
// and Tables marks a column required. FLOW_SHOTS=<folder> saves screenshots at desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.FLOW_SHOTS;
/** `focus` is scrolled into view at each width, the pointer moved off what it last touched. */
async function shot(page: Page, name: string, focus?: Locator) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  const size = page.viewportSize();
  await page.mouse.move(1, 1);
  await focus?.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await focus?.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, `${name}-phone.png`) });
  if (size) await page.setViewportSize(size);
}

/** A project with a leads table whose phone column is required, and the Flows screen open in English. */
async function leads(page: Page, name: string) {
  await rpc("setup.finish");
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name })).project.id;
  await rpc("tables.create", { project, name: "leads", columns: ["email", "name", "phone"] });
  await rpc("tables.column_required", { project, table: "leads", column: "phone", required: true });
  await page.addInitScript(() => localStorage.setItem("apx.prefs", JSON.stringify({ language: "en" })));
  await open(page, `#view=flows&scope=${project}`);
  return project;
}

async function newFlow(page: Page, name: string) {
  await page.getByRole("button", { name: "New flow" }).first().click();
  const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Add Incoming webhook" }) });
  await editor.getByRole("textbox", { name: "Flow name" }).fill(name);
  await editor.getByRole("button", { name: "Add Incoming webhook" }).click();
  return editor;
}

test("a check of two comparisons joined by and routes a Simulate run; a save that leaves a required column empty is unfinished", async ({
  page,
}) => {
  const project = await leads(page, "Check fields");
  const editor = await newFlow(page, "Lead intake");
  await editor.getByRole("button", { name: "Add Check" }).click();
  await editor.getByRole("textbox", { name: "Name of this case" }).fill("Complete");
  // Comparisons first, the formula a tab beside them; each side takes the `{}` picker.
  await expect(editor.getByRole("radio", { name: "Compare" })).toBeChecked();
  const field = editor.getByRole("textbox", { name: "What it looks at", exact: true });
  await field.first().fill("$trigger.verified");
  await editor.getByRole("radio", { name: "Yes or no" }).first().click();
  await expect(editor.getByRole("radio", { name: "Yes", exact: true }).first()).toBeChecked();
  await editor.getByRole("button", { name: "Add comparison" }).click();
  await field.nth(1).fill("$trigger.email");
  await editor.getByRole("combobox", { name: "How it compares" }).nth(1).click();
  await page.getByRole("option", { name: "Contains" }).click();
  await editor.getByRole("textbox", { name: "Compared with", exact: true }).fill("@");
  await expect(editor.getByRole("radio", { name: "And" })).toBeChecked();
  await shot(page, "check-and", page.getByRole("button", { name: "Add comparison" }));

  // After the check, by its first way out: a save whose required phone is left empty.
  await editor.getByRole("button", { name: "Add Save to table" }).click();
  await editor.getByRole("combobox", { name: "Table", exact: true }).click();
  await page.getByRole("option", { name: /^leads/ }).click();
  await editor.getByRole("textbox", { name: "Key", exact: true }).fill("$trigger.email");
  await editor.getByRole("textbox", { name: "email", exact: true }).fill("$trigger.email");
  await expect(editor.getByText("Required: choose what goes here").first()).toBeVisible();
  await shot(page, "save-required", page.locator(".ft-preview"));
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toHaveText("Complete «Save to table».");

  // Filled, the drawing is complete: Simulate follows the check by what arrives.
  await editor.getByRole("textbox", { name: /^phone/ }).fill("$trigger.phone");
  await editor.getByRole("button", { name: "Simulate" }).click();
  const sample = page.getByRole("textbox", { name: "Data that arrives" });
  await sample.fill('{"verified": true, "email": "ana@example.com", "phone": "555"}');
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await expect(page.getByText("It would get to: Save to table.")).toBeVisible();
  await sample.fill('{"verified": true, "email": "no address", "phone": "555"}');
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await expect(page.getByText("The checks would stop it. Nothing would run.")).toBeVisible();
  await sample.fill('{"verified": "false", "email": "bo@example.com"}');
  await page.getByRole("button", { name: "Try", exact: true }).click();
  await expect(page.getByText("The checks would stop it. Nothing would run.")).toBeVisible();
  await page.keyboard.press("Escape");

  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("Saved. Turn it on to run it as drawn.");
  const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0];
  const doc = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow: flow?.id ?? "" });
  const check = doc.draft?.nodes.find((n) => n.kind === "condition");
  expect(check?.kind === "condition" && check.cases?.[0]).toMatchObject({
    label: "Complete",
    match: {
      kind: "all",
      rules: [
        { left: "$trigger.verified", op: "equals", right: "true", type: "boolean" },
        { left: "$trigger.email", op: "contains", right: "@", type: "text" },
      ],
    },
  });
});

test("a read brings two of its table's three columns, each with the name a later step reads", async ({ page }) => {
  const project = await leads(page, "Read fields");
  const editor = await newFlow(page, "Lead lookup");
  await editor.getByRole("button", { name: "Add Read table" }).click();
  await editor.getByRole("combobox", { name: "Table", exact: true }).click();
  await page.getByRole("option", { name: /^leads/ }).click();
  await expect(editor.getByRole("radio", { name: "One row, by its key" })).toBeChecked();
  await expect(editor.getByText("Brings the row saved under this key, or nothing when there is none.")).toBeVisible();
  for (const c of ["email", "name", "phone"]) await expect(editor.getByRole("checkbox", { name: c })).toBeChecked();
  await editor.getByRole("checkbox", { name: "phone" }).click();
  await expect(editor.getByRole("checkbox", { name: "phone" })).not.toBeChecked();
  await expect(editor.locator(".ft-picks")).toContainText("$steps.table_read-1.name");
  await expect(editor.locator(".ft-picks")).not.toContainText("$steps.table_read-1.phone");
  await editor.getByRole("textbox", { name: "Key", exact: true }).fill("$trigger.email");
  await shot(page, "read-columns", page.locator(".ft-picks"));
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("Saved. Turn it on to run it as drawn.");
  const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0];
  const doc = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow: flow?.id ?? "" });
  expect(doc.draft?.nodes.find((n) => n.kind === "table_read")).toMatchObject({
    table: "leads",
    keys: ["$trigger.email"],
    columns: ["email", "name"],
  });
});

test("Tables marks a column required, and a row added there asks for it", async ({ page }) => {
  const project = await leads(page, "Required fields");
  await open(page, `#view=flows&scope=${project}&tab=tables&table=leads`);
  await expect(page.getByRole("columnheader", { name: "phone *" })).toBeVisible();
  await page.getByRole("button", { name: "Column name" }).click();
  await page.getByRole("menuitem", { name: "Make required" }).click();
  await expect(page.getByRole("columnheader", { name: "name *" })).toBeVisible();
  expect((await rpc<Result<"tables.get">>("tables.get", { project, table: "leads" })).table.required).toEqual([
    "name",
    "phone",
  ]);
  await shot(page, "tables-required");
  await page.getByRole("button", { name: "Add row" }).click();
  const row = page.getByRole("dialog", { name: "Add row" });
  await row.getByRole("textbox", { name: "Key" }).fill("ana");
  await row.getByRole("textbox", { name: "name *" }).fill("Ana");
  await expect(row.getByRole("button", { name: "Save row" })).toBeDisabled();
  await row.getByRole("textbox", { name: "phone *" }).fill("555");
  await row.getByRole("button", { name: "Save row" }).click();
  await expect(page.getByRole("button", { name: "Edit the row ana" })).toBeVisible();
  // Optional again from the same menu.
  await page.getByRole("button", { name: "Column name" }).click();
  await page.getByRole("menuitem", { name: "Make optional" }).click();
  await expect(page.getByRole("columnheader", { name: "name *" })).toHaveCount(0);
  await expect
    .poll(async () => (await rpc<Result<"tables.get">>("tables.get", { project, table: "leads" })).table.required)
    .toEqual(["phone"]);
});
