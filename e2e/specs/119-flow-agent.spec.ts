// The super-agent draws a Flow when asked in a chat: the answer carries a card with the Flow's name, its project, that
// it is a draft and a picture of its steps; a draft saved elsewhere redraws it, and Open in the editor opens that Flow.
// FLOW_SHOTS=<folder> saves screenshots of the card: dark and light, desktop and phone width.
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
  for (const mode of ["dark", "light"] as const) {
    await page.evaluate((m) => {
      for (const el of document.querySelectorAll("[data-apx-mode]")) el.setAttribute("data-apx-mode", m);
    }, mode);
    await page.screenshot({ path: path.join(shots, `${name}-${mode}.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    // The phone layout draws the chat anew: wait for the card's steps before looking.
    await expect(page.locator(".flowcard .react-flow__node")).toHaveCount(3);
    await page.locator(".flowcard").evaluate((el) => el.scrollIntoView({ block: "center" }));
    // The narrower card fits the whole drawing again: every step shows, smaller.
    const scale = async () =>
      Number(
        /scale\(([\d.]+)\)/.exec(
          (await page.locator(".flowcard .react-flow__viewport").getAttribute("style")) ?? "",
        )?.[1],
      );
    await expect.poll(scale).toBeLessThan(0.5);
    await page.screenshot({ path: path.join(shots, `${name}-${mode}-phone.png`) });
    if (size) await page.setViewportSize(size);
  }
}

test("a Flow the super-agent draws shows in the chat and opens in the editor", async ({ page }) => {
  await rpc("setup.finish", {});
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Acme leads" })).project.id;
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Flows" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill(`draw a flow in ${project}`);
  await page.keyboard.press("Enter");

  const card = page.locator(".flowcard");
  await expect(card).toContainText("New leads");
  await expect(card).toContainText("Acme leads");
  await expect(card).toContainText("Borrador");
  await expect(card).toContainText("Todavía no corre: revisalo en el editor y prendelo.");
  await expect(card.locator(".react-flow__node")).toHaveCount(2);
  await expect(card.locator(".react-flow__node").first()).toContainText("New lead");
  // Nothing was asked of the owner: a draft runs nothing.
  await expect(page.locator(".inputcard.is-pending")).toHaveCount(0);

  const flows = (await rpc<Result<"flows.list">>("flows.list", { project })).flows;
  expect(flows).toHaveLength(1);
  const flow = flows[0]?.id ?? "";
  expect(flows[0]?.enabled).toBe(false);

  // A draft saved elsewhere (the editor, another chat) is drawn again on the card.
  const doc = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
  const draft = doc.draft as NonNullable<typeof doc.draft>;
  await rpc("flows.draft_save", {
    flow,
    expectedVersion: doc.draftVersion,
    graph: {
      ...draft,
      nodes: [
        ...draft.nodes,
        {
          id: "late",
          kind: "js",
          label: "Clean it",
          code: "return input;",
          input: { kind: "event", path: [] },
          timeoutMs: 2000,
        },
      ],
      edges: [...draft.edges, { source: "save", target: "late" }],
      layout: [...draft.layout, { node: "late", x: 560, y: 0 }],
    },
  });
  await expect(card.locator(".react-flow__node")).toHaveCount(3);
  await shot(page, "flow-card");

  await card.getByRole("button", { name: "Abrir en el editor" }).click();
  await expect(page).toHaveURL(new RegExp(`view=flows.*flow=${flow}.*edit=1`));
  await expect(page.getByRole("textbox", { name: "Nombre del flow" })).toHaveValue("New leads");
});

test("turning on a Flow an agent drew opens it for review instead of running it", async ({ page }) => {
  await rpc("setup.finish", {});
  const project = (await rpc<{ project: { id: string } }>("projects.create", { name: "Acme review" })).project.id;
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Review" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill(`draw a flow in ${project}`);
  await page.keyboard.press("Enter");
  await expect(page.locator(".flowcard")).toContainText("Borrador");
  const flow = (await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.id ?? "";

  await open(page, `#view=flows&scope=${project}`);
  await page.getByRole("switch", { name: "Encender o apagar New leads" }).click();
  await expect(
    page.getByText("Un agente dibujó estos cambios: revisalos y guardalos, después prendé el flow."),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`flow=${flow}.*edit=1`));
  const doc = await rpc<Result<"flows.graph_get">>("flows.graph_get", { flow });
  expect(doc.publishedRevision).toBeNull();
  expect((await rpc<Result<"flows.list">>("flows.list", { project })).flows[0]?.enabled).toBe(false);
});
