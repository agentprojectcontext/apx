// Writing while the agent works (DECISIONS.md#d-186): Ctrl/⌘+Enter puts a message in line, where it is edited, moved
// and removed before its turn; Enter sends it into the running turn, and "Send now" stops the step it is on so the
// agent reads it at once. What is in line then runs in its order, each above its answer.
import { expect, open, rpc, test } from "./kit.ts";

test("messages in line are edited, moved and removed, and Send now has the agent read one at once", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Cola" });
  await open(page, `#thread=${chat.id}`);
  const box = page.getByRole("textbox", { name: /Escribile/ });
  await box.fill("work for a long while");
  await page.keyboard.press("Enter");
  await expect(page.locator(".turn__tools")).toContainText("Trabajando · paso 1");
  // While it works the composer says how to leave a message in line.
  await expect(page.locator(".apx-composer__hint")).toHaveText(/\+Enter para dejarlo en cola/);

  for (const words of ["first in line", "second in line", "third in line"]) {
    await box.fill(words);
    await page.keyboard.press("ControlOrMeta+Enter");
  }
  const line = page.locator(".waiting__line");
  await expect(line.getByText("En cola para cuando Scout termine")).toBeVisible();
  const queued = line.locator(".apx-msg.is-waiting");
  await expect(queued).toHaveCount(3);

  // Second goes first; third is taken out; first is edited.
  await queued.filter({ hasText: "second in line" }).getByRole("button", { name: "Subir" }).click();
  await expect(queued.first()).toContainText("second in line");
  await queued.filter({ hasText: "third in line" }).getByRole("button", { name: "Quitar" }).click();
  await expect(queued).toHaveCount(2);
  await queued.filter({ hasText: "first in line" }).getByRole("button", { name: "Editar" }).click();
  const edit = line.getByRole("textbox", { name: "Editar" });
  await edit.fill("first, edited");
  await line.getByRole("button", { name: "Guardar" }).click();
  await expect(queued.last()).toContainText("first, edited");

  // Sent with Enter: it waits for the next step, with "Send now" in sight.
  await box.fill("use metric units");
  await page.keyboard.press("Enter");
  const sent = page.locator(".apx-msg", { hasText: "use metric units" });
  const now = sent.getByRole("button", { name: "Enviar ahora" });
  await expect(now).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("queue-desktop.png") });
  await page.setViewportSize({ width: 375, height: 760 });
  await expect(queued.first().getByRole("button", { name: "Enviar ahora" })).toBeVisible();
  await expect(now).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("queue-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 800 });

  // The step would sleep for 25 s: Send now stops it and the agent answers within the test's time.
  await now.click();
  await expect(page.getByText("Got it: use metric units")).toBeVisible({ timeout: 10_000 });
  await expect(now).toBeHidden();
  // Taken: two ticks and "Ahora" take the place of the button.
  await expect(sent.getByText("Ahora")).toBeVisible();
  await expect(page.getByText("Got it: first, edited")).toBeVisible({ timeout: 15_000 });
  await expect(line).toHaveCount(0);

  const order = await page
    .locator(".apx-msg")
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
  const at = (text: string) => order.findIndex((t) => t.includes(text));
  expect(at("Got it: use metric units")).toBeGreaterThan(at("use metric units"));
  expect(at("second in line")).toBeGreaterThan(at("Got it: use metric units"));
  expect(at("Got it: second in line")).toBeGreaterThan(at("second in line"));
  expect(at("first, edited")).toBeGreaterThan(at("Got it: second in line"));
  expect(at("Got it: first, edited")).toBeGreaterThan(at("first, edited"));
  expect(at("third in line")).toBe(-1);
});
