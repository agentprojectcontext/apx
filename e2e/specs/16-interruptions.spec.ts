// Interruptions: the owner sets how often APX may write unasked; a second notice of the same kind soon after the first
// stays in the tray, and the log says so.
import { expect, open, rpc, test, until } from "./kit.ts";

test("the daily cap is set in Interruptions, and a notice too soon after another stays in the tray", async ({
  page,
}) => {
  // Earlier specs sent notices today: a high cap keeps the count out of this test.
  const prefs = await rpc<Record<string, unknown>>("notices.get");
  await rpc("notices.set", { ...prefs, budget_per_day: 50 });
  const r = await rpc<{ id: string }>("routines.set", {
    name: "nudge-probe",
    agent: "roby",
    schedule: { kind: "manual" },
    action: "message",
    prompt: "Probe from the budget",
    enabled: true,
  });
  const runs = async () =>
    (await rpc<{ runs: Array<{ state: string }> }>("routines.runs", { routine: r.id })).runs.filter(
      (x) => x.state !== "working",
    ).length;
  for (let i = 1; i <= 2; i++) {
    await rpc("routines.run", { routine: r.id });
    await until(async () => (await runs()) >= i);
  }

  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("interrup");
  await page.getByRole("option", { name: /Interrupciones/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  const cap = dialog.getByRole("spinbutton", { name: "Mensajes no pedidos por día" });
  await expect(cap).toHaveValue("50");
  await cap.fill("5");
  await expect.poll(async () => (await rpc<{ budget_per_day: number }>("notices.get")).budget_per_day).toBe(5);

  const probes = dialog.locator(".nudge__item", { hasText: "Probe from the budget" });
  await expect(probes).toHaveCount(2);
  await expect(probes.first().getByText("solo en la bandeja")).toBeVisible();
  await expect(probes.first().getByText(/too soon after another of this kind/)).toBeVisible();
  await expect(probes.last().getByText("enviado", { exact: true })).toBeVisible();
});
