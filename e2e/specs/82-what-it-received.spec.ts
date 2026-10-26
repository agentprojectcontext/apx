// What a model call carried, for the owner: an answer opens what its turn received (sizes by part, then the texts),
// and the agent editor says how long its instructions are and when they get long.
import { expect, open, rpc, test } from "./kit.ts";

test("an answer shows what its turn received: the parts' sizes, the system prompt, the input and the tools", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const t = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Received" });
  await open(page, `#view=inbox&thread=${t.id}`);
  const main = page.getByRole("main");
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Northwind hola");
  await box.press("Enter");
  const answer = main.locator(".apx-msg--agent", { hasText: "Got it: Northwind hola" });
  await expect(answer).toBeVisible();
  await answer.hover();
  await answer.getByRole("button", { name: "Ver lo que recibió" }).click();

  const dialog = page.getByRole("dialog", { name: "Lo que recibió" });
  await expect(dialog.getByRole("cell", { name: "Prompt de sistema" }).first()).toBeVisible();
  await expect(dialog.getByRole("cell", { name: "Texto propio de APX" })).toBeVisible();
  await expect(dialog.getByRole("cell", { name: "El mensaje" })).toBeVisible();
  await expect(dialog.getByRole("cell", { name: /^Herramientas \(\d+\)$/ }).first()).toBeVisible();
  await dialog.locator("summary", { hasText: "Prompt de sistema" }).click();
  await expect(dialog.locator("pre").first()).toContainText("an agent in APX");
  await dialog.locator("summary", { hasText: "Entrada del turno" }).click();
  await expect(dialog.locator("pre").nth(1)).toContainText("Northwind hola");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the agent editor says how long its instructions are, and warns once they are long", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("agents.create", { slug: "ledger-size", name: "Ledger" });
  await open(page, "#project=~default&tab=team");
  await page.locator(".teamcanvas__node", { hasText: "Ledger" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const editor = page.getByRole("dialog", { name: "Editar a Ledger" });
  await editor.getByRole("button", { name: "Prompt" }).click();
  const text = editor.getByRole("textbox", { name: "Prompt" });
  await text.fill("Keep the books of Northwind.");
  await expect(editor.getByRole("status")).toHaveText(
    "28 caracteres, unos 7 tokens, que van en cada llamada al modelo.",
  );
  await text.fill("Keep the books of Northwind. ".repeat(160));
  await expect(editor.getByRole("status")).toContainText("es largo");
});
