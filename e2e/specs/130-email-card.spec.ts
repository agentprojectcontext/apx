// An email an agent drafts shows as a card: with a way to send it the owner sends it from the card after a few
// seconds they can undo; without one, the card opens it in their mail app.
import type { Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

async function draftIn(page: Page) {
  const t = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    title: "Launch mail",
  });
  await open(page, `#view=inbox&thread=${t.id}`);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("write an email to Dana");
  await box.press("Enter");
  const card = page.getByRole("main").locator(".mailcard");
  await expect(card.getByText("Friday launch")).toBeVisible();
  await expect(card.getByText("dana@example.com")).toBeVisible();
  await expect(card.getByText("The banner and the post are ready")).toBeVisible();
  return card;
}

test("a drafted email is sent from its card, and a send can be undone first", async ({ page }) => {
  await rpc("setup.finish", {});
  // Gmail is not reachable here: it stands as connected and its send is recorded.
  const sends: unknown[] = [];
  await page.route("**/rpc/mail.routes", (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: { routes: [{ kind: "gmail", id: "gmail", label: "Gmail", address: "user@example.com" }], sent: [] },
      },
    }),
  );
  await page.route("**/rpc/mail.send", async (route) => {
    sends.push(route.request().postDataJSON());
    await route.fulfill({
      json: { ok: true, result: { key: "k", at: new Date().toISOString(), via: "user@example.com" } },
    });
  });
  const card = await draftIn(page);

  await card.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(card.getByText(/^Se envía en \d s$/)).toBeVisible();
  await card.getByRole("button", { name: "Deshacer" }).click();
  await expect(card.getByRole("button", { name: "Enviar", exact: true })).toBeVisible();
  expect(sends).toHaveLength(0);

  await card.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(card.getByText("Enviado desde user@example.com")).toBeVisible({ timeout: 10_000 });
  expect(sends).toHaveLength(1);
  expect(JSON.stringify(sends[0])).toContain("dana@example.com");
});

test("without a way to send, a drafted email opens in the owner's mail app", async ({ page }) => {
  await rpc("setup.finish", {});
  const card = await draftIn(page);
  await expect(card.getByRole("button", { name: "Abrir en tu app de correo" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Enviar", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Abrir en…" }).click();
  for (const app of ["App de correo", "Gmail en la web", "Outlook en la web"])
    await expect(page.getByRole("menuitem", { name: app })).toBeVisible();
});
