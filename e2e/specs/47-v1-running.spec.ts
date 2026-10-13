import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("APX v1 todavía prendido: la tarjeta lo dice y Apagar v1 lo apaga", async ({ page }) => {
  let running = true;
  let tookOver = 0;
  await page.route("**/rpc/setup.status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.v1_running = running;
    await route.fulfill({ response, json: body });
  });
  // The take-over itself stops services on this machine: here it only answers, the core's unit tests cover it.
  await page.route("**/rpc/setup.take_over_cli", async (route) => {
    tookOver++;
    running = false;
    await route.fulfill({ json: { ok: true, result: { ok: true, detail: "APX v1's daemon is off" } } });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#view=inbox");
  const card = page.locator('.corner__card[data-card="v1"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("APX v1 sigue prendido");
  await card.getByRole("button", { name: "Apagar v1" }).click();
  await expect.poll(() => tookOver).toBe(1);
  await expect(card).toBeHidden();
});
