// Editing one of the owner's messages and asking again for an answer: the chat goes back there, later messages go
// (asked first when there are any) and the agent answers again.
import { expect, open, rpc, test } from "./kit.ts";

test("the owner edits a message and asks again for an answer; what came after goes, asked first", async ({ page }) => {
  await rpc("setup.finish", {});
  const t = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: "Rewind" });
  await open(page, `#view=inbox&thread=${t.id}`);
  const main = page.getByRole("main");
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  for (const text of ["Northwind uno", "Northwind dos"]) {
    await box.fill(text);
    await box.press("Enter");
    await expect(main.locator("p", { hasText: `Got it: ${text}` })).toBeVisible();
  }

  // The last message: edited in place, no question (only its own answer is replaced).
  const last = main.locator(".apx-msg--user", { hasText: "Northwind dos" });
  await last.hover();
  await last.getByRole("button", { name: "Editar mensaje" }).click();
  const editor = main.getByRole("textbox", { name: "Editar mensaje" });
  await editor.fill("Northwind tres");
  await editor.press("Enter");
  await expect(main.locator("p", { hasText: "Got it: Northwind tres" })).toBeVisible();
  await expect(main.getByText("Northwind dos")).toHaveCount(0);

  // An earlier one: what came after it goes, so it asks first.
  const first = main.locator(".apx-msg--user", { hasText: "Northwind uno" });
  await first.hover();
  await first.getByRole("button", { name: "Editar mensaje" }).click();
  await main.getByRole("textbox", { name: "Editar mensaje" }).fill("Northwind cuatro");
  await main.getByRole("button", { name: "Enviar", exact: true }).first().click();
  const confirm = page.getByRole("dialog", { name: "¿Borrar lo que vino después?" });
  await expect(confirm).toContainText("Se borran 2 mensajes posteriores");
  await confirm.getByRole("button", { name: "Borrar y enviar" }).click();
  await expect(main.locator("p", { hasText: "Got it: Northwind cuatro" })).toBeVisible();
  await expect(main.locator(".apx-msg--user")).toHaveCount(1);

  // Asking again for the last answer replaces it.
  const answer = main.locator(".apx-msg--agent", { hasText: "Got it: Northwind cuatro" });
  await answer.hover();
  await answer.getByRole("button", { name: "Regenerar respuesta" }).click();
  await expect(main.locator(".apx-msg--user")).toHaveCount(1);
  await expect(main.locator("p", { hasText: "Got it: Northwind cuatro" })).toHaveCount(1);
});
