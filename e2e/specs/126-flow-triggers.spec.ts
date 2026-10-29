// The trigger cards (DECISIONS.md#d-182): a schedule set by days and times with no cron typed, the trigger switched to
// a webhook in place with its connection kept, the webhook taking GET, and its key made and replaced from the card.
// FLOW_SHOTS=<folder> saves both cards at desktop and phone width.
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const shots = process.env.FLOW_SHOTS;
async function shot(page: Page, name: string, focus: Locator) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  const size = page.viewportSize();
  await page.mouse.move(1, 1);
  await focus.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await focus.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, `${name}-phone.png`) });
  if (size) await page.setViewportSize(size);
}
const HOST = "https://apx.example.com";
const docOf = (flow: string) => rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });

test.afterEach(async () => {
  await rpc("webhooks.set", { mode: "off" });
});

test("a schedule is set by days and times, switched to a webhook in place, which takes GET with its own key", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  await rpc("webhooks.set", { mode: "custom", url: HOST });
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Acme triggers" })).project.id;
  await rpc("tables.create", { project, name: "visits" });
  const made = await rpc<Result<"flows.create">>("flows.create", {
    project,
    name: "Store visits",
    graph: {
      schemaVersion: 2,
      nodes: [
        { id: "start", kind: "schedule", label: "Schedule", cron: "30 8 * * 1-5" },
        {
          id: "save",
          kind: "table_write",
          label: "Save the visit",
          table: "visits",
          key: "latest",
          value: { kind: "event", path: [] },
        },
      ],
      edges: [{ source: "start", target: "save" }],
      layout: [
        { node: "start", x: 0, y: 0 },
        { node: "save", x: 280, y: 0 },
      ],
    },
  });
  const flow = made.flow.id;
  const route = made.flow.path ?? "";
  await page.addInitScript(() => localStorage.setItem("apx.prefs", JSON.stringify({ language: "en" })));
  await open(page, `#view=flows&scope=${project}&flow=${flow}&edit=1`);
  const editor = page.locator(".fe");
  const trigger = editor.locator('.react-flow__node[data-id="start"]');
  await trigger.click();
  const card = editor.locator(".fe-card");

  // Fixed times, read from the cron: Monday to Friday at 08:30. Monday also at 05:00, Tuesday off.
  await expect(card.getByRole("radio", { name: "Fixed times" })).toBeChecked();
  await card.getByRole("button", { name: "Add a time on Monday" }).click();
  await card.getByLabel("Time on Monday").nth(1).fill("05:00");
  await card.getByRole("button", { name: "Tuesday", exact: true }).click();
  await expect(card.getByRole("button", { name: "Tuesday", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(trigger).toContainText("Mon 05:00, 08:30 · Wed, Thu, Fri 08:30");
  // Its next runs come from the crons it makes, Monday's 05:00 among them.
  await expect(card.locator(".fe-next")).toContainText("05:00");
  await shot(page, "schedule-card", card.getByRole("button", { name: "Sunday", exact: true }));
  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(editor.getByRole("status")).toContainText("Draft saved");
  let doc = await docOf(flow);
  expect(doc.draft?.nodes[0]).toMatchObject({ kind: "schedule", cron: "0 5 * * 1; 30 8 * * 1; 30 8 * * 3-5" });

  // Every…: a count and a unit, still one cron.
  await card.getByRole("radio", { name: "Every…" }).click();
  await expect(trigger).toContainText("0 9 * * *");

  // Switched to a webhook: same step, same connection, its address on the card.
  await card.getByRole("radio", { name: "Webhook", exact: true }).click();
  await expect(trigger).toContainText(`POST /flows/${route}`);
  await expect(card).toContainText(`${HOST}/flows/${route}`);
  await card.getByRole("radio", { name: "GET", exact: true }).click();
  await expect(trigger).toContainText(`GET /flows/${route}`);
  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(editor.getByRole("status")).toContainText("Draft saved");
  doc = await docOf(flow);
  expect(doc.draft?.nodes[0]).toEqual({ id: "start", kind: "webhook", label: "Incoming webhook", methods: ["GET"] });
  expect(doc.draft?.edges).toEqual([{ source: "start", target: "save" }]);

  // The key: made from the card, shown, then replaced after a warning; the old one stops.
  await card.getByRole("button", { name: "Create key" }).click();
  await expect(card.locator(".trg-key")).toHaveText(/^apxp_[a-f0-9]{64}$/);
  const first = (await rpc<Result<"flows.token">>("flows.token", { flow })).token ?? "";
  await expect(card.locator(".trg-key")).toHaveText(first);
  await shot(page, "webhook-card", card.getByRole("button", { name: "New key" }));
  await card.getByRole("button", { name: "New key" }).click();
  const ask = page.getByRole("dialog", { name: "Replace the key?" });
  await expect(ask).toContainText("Services that use it can't reach this flow");
  await ask.getByRole("button", { name: "Replace it" }).click();
  await expect(card.locator(".trg-key")).not.toHaveText(first);
  const second = (await rpc<Result<"flows.token">>("flows.token", { flow })).token ?? "";
  expect(second).not.toBe(first);

  // Published and on, the address answers GET with the new key only.
  await rpc("flows.publish", { flow, expectedDraftVersion: doc.draftVersion, expectedPublishedRevision: null });
  await rpc("flows.set", { ...made.flow, enabled: true });
  const port = (await rpc<Result<"webhooks.get">>("webhooks.get", {})).port;
  const call = (token: string, method = "GET") =>
    fetch(`http://127.0.0.1:${port}/flows/${route}?id=v1&store=north`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
  expect((await call(first)).status).toBe(401);
  expect((await call(second, "POST")).status).toBe(405);
  expect((await call(second)).status).toBe(202);
  const rows = await rpc<Result<"tables.get">>("tables.get", { project, table: "visits", limit: 5 });
  expect(rows.rows[0]?.value).toEqual({ store: "north" });
});

test("what a step receives is picked with {} like every other value: a field of what arrived or an earlier step", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Acme receives" })).project.id;
  const made = await rpc<Result<"flows.create">>("flows.create", {
    project,
    name: "Lead tiers",
    graph: {
      schemaVersion: 2,
      nodes: [
        { id: "start", kind: "webhook", label: "New lead" },
        {
          id: "tier",
          kind: "js",
          label: "Tier",
          code: "return input;",
          input: { kind: "event", path: [] },
          timeoutMs: 2000,
        },
      ],
      edges: [{ source: "start", target: "tier" }],
      layout: [
        { node: "start", x: 0, y: 0 },
        { node: "tier", x: 280, y: 0 },
      ],
    },
  });
  await page.addInitScript(() => localStorage.setItem("apx.prefs", JSON.stringify({ language: "en" })));
  await open(page, `#view=flows&scope=${project}&flow=${made.flow.id}&edit=1`);
  const editor = page.locator(".fe");
  await editor.locator('.react-flow__node[data-id="tier"]').click();
  const card = editor.locator(".fe-card");
  const receives = card.getByRole("textbox", { name: "What it receives" });
  // Empty is everything that arrived; the picker offers it, and a field typed after it narrows it.
  await card.getByRole("button", { name: "Insert a value" }).first().click();
  await page.getByRole("option", { name: /Everything that arrived/ }).click();
  await expect(card.locator(".apx-tfield").first()).toContainText("$trigger");
  await receives.fill("$trigger.form.tier");
  await shot(page, "receives-picker", receives);
  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(editor.getByRole("status")).toContainText("Draft saved");
  const doc = await docOf(made.flow.id);
  expect(doc.draft?.nodes.find((n) => n.id === "tier")).toMatchObject({
    input: { kind: "event", path: ["form", "tier"] },
  });
});
