import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("helper retries accepted requests without creating duplicate chats or turns", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Helper handoff" });
  await open(page, `#project=${project.id}&tab=overview`);
  await page.getByRole("button", { name: "Revisar contexto del proyecto" }).click();
  const helper = page.getByRole("dialog", { name: "Revisar contexto del proyecto" });
  await helper.getByRole("textbox", { name: "¿Qué debería lograr este proyecto?" }).fill("Review the catalog");
  await helper.getByRole("textbox", { name: "¿Cuál sería un primer resultado útil?" }).fill("A short plan");
  const keys = { create: [] as string[], send: [] as string[] };
  for (const [method, seen] of [
    ["threads.create", keys.create],
    ["threads.send", keys.send],
  ] as const) {
    await page.route(`**/rpc/${method}`, async (route) => {
      seen.push(route.request().headers()["idempotency-key"] ?? "");
      const response = await route.fetch();
      if (seen.length === 1) {
        await route.fulfill({
          status: 200,
          json: { ok: false, error: { code: "internal", message: "Accepted reply unavailable", retryable: true } },
        });
      } else await route.fulfill({ response });
    });
  }
  const start = helper.getByRole("button", { name: "Enviar resumen y empezar" });
  await start.click();
  await expect(page.getByText("Accepted reply unavailable", { exact: true })).toBeVisible();
  await expect(start).toBeEnabled();
  await start.click();
  await expect.poll(() => keys.send.length).toBe(1);
  await expect(start).toBeEnabled();
  await start.click();
  await expect(helper).toBeHidden();
  const { threads } = await rpc<Result<"threads.list">>("threads.list", { project_id: project.id });
  expect(threads).toHaveLength(1);
  const details = await rpc<Result<"threads.get">>("threads.get", { thread: threads[0]?.id });
  expect(details.messages.filter((message) => message.author.kind === "user")).toHaveLength(1);
  expect(details.runs).toHaveLength(1);
  expect(keys.create).toHaveLength(2);
  expect(keys.send).toHaveLength(2);
  expect(new Set(keys.create).size).toBe(1);
  expect(new Set(keys.send).size).toBe(1);
});

test("helper locks edits during save and stops follow-on work after navigating away", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Helper lifecycle" });
  await open(page, `#project=${project.id}&tab=overview`);
  await page.getByRole("button", { name: "Revisar contexto del proyecto" }).click();
  const helper = page.getByRole("dialog", { name: "Revisar contexto del proyecto" });
  const goal = helper.getByRole("textbox", { name: "¿Qué debería lograr este proyecto?" });
  const result = helper.getByRole("textbox", { name: "¿Cuál sería un primer resultado útil?" });
  await goal.fill("Review the catalog");
  await result.fill("A short plan");
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saving = false;
  await page.route("**/rpc/projects.helper_set", async (route) => {
    saving = true;
    await held;
    await route.continue();
  });
  await helper.getByRole("button", { name: "Enviar resumen y empezar" }).click();
  await expect.poll(() => saving).toBe(true);
  await expect(goal).toBeDisabled();
  await expect(result).toBeDisabled();
  await expect(helper.getByRole("button", { name: "Un prototipo pequeño que funcione" })).toBeDisabled();
  await page.evaluate(() => {
    window.location.hash = "#thread=home";
  });
  await expect(helper).toBeHidden();
  release?.();
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).hash).toBe("#thread=home");
  const { threads } = await rpc<Result<"threads.list">>("threads.list", { project_id: project.id });
  expect(threads).toHaveLength(0);
});
