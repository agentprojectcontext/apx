// Reviewing a project with its agent: a retry after a lost answer makes no second chat, the button holds while it
// works, and a chat made after the owner left is neither opened nor kept. Its first message is sent by the chat's
// own composer, like any chat's.
import type { Page } from "@playwright/test";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

/** Lets the core take the call, then answers the page with an error the first time only. */
async function loseFirstAnswer(page: Page, method: string, seen: string[]) {
  await page.route(`**/rpc/${method}`, async (route) => {
    seen.push(route.request().headers()["idempotency-key"] ?? "");
    const response = await route.fetch();
    if (seen.length === 1)
      await route.fulfill({
        status: 200,
        json: { ok: false, error: { code: "internal", message: "Accepted reply unavailable", retryable: true } },
      });
    else await route.fulfill({ response });
  });
}

test("a review retried after a lost answer makes one chat, and its first message one turn", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Helper handoff" });
  await open(page, `#project=${project.id}&tab=overview`);
  const keys: string[] = [];
  await loseFirstAnswer(page, "threads.create", keys);

  const talk = page
    .getByRole("region", { name: "Revisar el proyecto" })
    .getByRole("button", { name: /^Hablarlo con / });
  await talk.click();
  await expect(page.getByText(/Accepted reply unavailable/).first()).toBeVisible();
  await expect(talk).toBeEnabled();
  await talk.click();
  const chat = page.getByRole("complementary", { name: "Revisión del proyecto" });
  await expect(chat.getByRole("textbox")).toHaveValue(/^Revisemos este proyecto/);

  await chat.getByRole("button", { name: "Enviar", exact: true }).click();

  const { threads } = await rpc<Result<"threads.list">>("threads.list", { project_id: project.id });
  expect(threads).toHaveLength(1);
  await expect
    .poll(async () => (await rpc<Result<"threads.get">>("threads.get", { thread: threads[0]?.id })).runs.length)
    .toBe(1);
  const details = await rpc<Result<"threads.get">>("threads.get", { thread: threads[0]?.id });
  expect(details.messages.filter((message) => message.author.kind === "user")).toHaveLength(1);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(1);
});

test("the review holds while its chat is made, and leaving first keeps no chat and opens none", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "Helper lifecycle" });
  await open(page, `#project=${project.id}&tab=overview`);
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let creating = 0;
  await page.route("**/rpc/threads.create", async (route) => {
    creating++;
    await held;
    await route.continue();
  });
  const talk = page
    .getByRole("region", { name: "Revisar el proyecto" })
    .getByRole("button", { name: /^Hablarlo con / });
  await talk.click();
  await expect.poll(() => creating).toBe(1);
  await expect(talk).toBeDisabled();

  await page.evaluate(() => {
    window.location.hash = "#thread=home";
  });
  await expect(talk).toBeHidden();
  release?.();
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).hash).toBe("#thread=home");
  expect(creating).toBe(1);
  await expect(page.getByRole("complementary", { name: "Revisión del proyecto" })).toHaveCount(0);
  await expect
    .poll(async () => (await rpc<Result<"threads.list">>("threads.list", { project_id: project.id })).threads.length)
    .toBe(0);
});
