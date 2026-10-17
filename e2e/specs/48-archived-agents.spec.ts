import { expect, open, openSettings, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});

test("Config › Agentes: un agente archivado se restaura o se borra para siempre", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const back = await rpc<{ id: string }>("agents.create", { slug: `vuelve-${stamp}`, name: `Vuelve ${stamp}` });
  const gone = await rpc<{ id: string }>("agents.create", { slug: `chau-${stamp}`, name: `Chau ${stamp}` });
  await rpc("agents.archive", { agent: back.id });
  await rpc("agents.archive", { agent: gone.id });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await openSettings(page);
  await page.getByRole("dialog").getByRole("navigation").getByRole("button", { name: "Agentes" }).click();
  const archived = page.getByRole("region", { name: "Archivados" });
  await archived.getByRole("button", { name: /^Archivados/ }).click();
  const row = (name: string) => archived.locator(".archived__row").filter({ hasText: name });
  await expect(row(`Vuelve ${stamp}`)).toBeVisible();

  await row(`Vuelve ${stamp}`).getByRole("button", { name: "Restaurar" }).click();
  await expect(row(`Vuelve ${stamp}`)).toHaveCount(0);
  await expect
    .poll(async () =>
      (await rpc<{ agents: Array<{ id: string }> }>("agents.list")).agents.some((a) => a.id === back.id),
    )
    .toBe(true);

  await row(`Chau ${stamp}`).getByRole("button", { name: "Borrar para siempre" }).click();
  const confirm = page.getByRole("dialog", { name: `¿Borrar a Chau ${stamp} para siempre?` });
  await confirm.getByRole("button", { name: "Borrar para siempre" }).click();
  await expect(confirm).toBeHidden();
  await expect(row(`Chau ${stamp}`)).toHaveCount(0);
  const left = await rpc<{ agents: Array<{ id: string }> }>("agents.archived");
  expect(left.agents.some((a) => a.id === gone.id)).toBe(false);
});
