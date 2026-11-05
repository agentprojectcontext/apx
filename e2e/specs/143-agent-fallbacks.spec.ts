// An agent's own fallback models (DECISIONS.md#d-195): added, moved and removed in its editor, and an answer a
// fallback gave is marked under the reply.

import type { Page } from "@playwright/test";
import type { Agent, Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

/** Kept with the run's results, for the designer's review. */
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });
const choiceOf = async () => (await rpc<{ agent: Agent }>("agents.get", { agent: "robina" })).agent.model_choice;

test("the owner lists, orders and removes an agent's fallback models, and sees when one answered", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("agents.create", {
    slug: "robina",
    name: "Robina",
    role: "Writer",
    model_choice: { model: "custom/fake-limited", router: false },
  });
  await open(page, "#project=~default&tab=team");
  await page.locator(".teamcanvas__node", { hasText: "Writer" }).last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const editor = page.getByRole("dialog", { name: "Editar a Robina" });
  await editor.getByRole("button", { name: "Modelo y equipo" }).click();
  await expect(editor.getByText("Modelos de respaldo")).toBeVisible();

  const add = editor.getByRole("button", { name: "Agregar respaldo" });
  for (const model of ["fake-1", "fake-2"]) {
    await add.click();
    await page.getByRole("option", { name: new RegExp(`custom/${model}`) }).click();
  }
  await expect.poll(choiceOf).toEqual({
    model: "custom/fake-limited",
    router: false,
    fallbacks: ["custom/fake-1", "custom/fake-2"],
  });
  const rows = editor.locator(".agentfallbacks .chain__item");
  await rows.nth(1).getByRole("button", { name: "Subir" }).click();
  await expect.poll(async () => (await choiceOf())?.fallbacks).toEqual(["custom/fake-2", "custom/fake-1"]);
  await expect(editor.getByRole("button", { name: "Modelo de Robina" })).toHaveText(
    "custom/fake-limited · 2 respaldos",
  );
  await shot(page, "agent-fallbacks-editor");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "agent-fallbacks-editor-phone");
  await page.setViewportSize({ width: 1280, height: 800 });

  await rows.nth(0).getByRole("button", { name: "Quitar este respaldo" }).click();
  await expect.poll(async () => (await choiceOf())?.fallbacks).toEqual(["custom/fake-1"]);
  // Models save as they are picked: nothing is left for the editor to save.
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);

  // Its own model is at its limit: the fallback answers, and the reply says so.
  const thread = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "robina", title: "Fallbacks" });
  await rpc("threads.send", { thread: thread.id, text: "hello" });
  await open(page, `#thread=${thread.id}`);
  const meta = page.locator(".apx-msgmeta").last();
  await expect(meta).toContainText("Robina");
  await expect(meta).toContainText("custom/fake-1");
  await expect(meta).toContainText("Con respaldo");
  await shot(page, "agent-fallbacks-reply");
});
