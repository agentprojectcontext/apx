import type { Page } from "@playwright/test";
import { test, expect, runtime } from "./fixtures";

/**
 * The phone opens a conversation — and when it cannot, it says so.
 *
 * Reported from the Android app: some conversations opened EMPTY. Two things
 * were behind it. The daemon stamped chats with a project NUMBER that moves
 * between boots, so the thread came back `404 project not found`
 * (tests/ledger-project-stable.test.js pins that half). And the chat pane drew
 * a failed load and an empty conversation as the same blank "send a message to
 * start" — so the 404 read as a chat with nothing in it, and nothing on screen
 * said otherwise once the toast faded.
 *
 * No stubs: the thread is created by talking to the super-agent (the gate runs
 * it on the offline `mock` engine), and the failure is a real 404 from the
 * daemon for a day that has no thread.
 */

const PHONE = { width: 390, height: 844 };

async function talk(page: Page, text: string) {
  await page.goto("/inbox");
  const box = page.getByRole("textbox", { name: /Type something|Escrib/ });
  await expect(box).toBeVisible();
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByText(new RegExp(`received: ${text}`)).first()).toBeVisible();
}

test.describe("phone chat", () => {
  test("a conversation that has messages opens WITH them on the phone", async ({ page, errors }) => {
    await talk(page, "Hola desde el escritorio");
    await page.setViewportSize(PHONE);
    await page.goto("/m/chat");
    await page.getByText("Hola desde el escritorio").first().click();
    await expect(page.getByText(/received: Hola desde el escritorio/).first()).toBeVisible();
    await expect(page.getByTestId("chat-load-error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a thread that cannot be opened says so, with a retry — it is not drawn as an empty chat", async ({ page }) => {
    await page.setViewportSize(PHONE);
    // A day with no thread: the daemon answers 404 for it.
    await page.goto("/m/chat/0/super_agent/web~2001-01-01");
    await expect(page.getByTestId("chat-load-error")).toBeVisible();
    await expect(page.getByText(/Send a message to start the conversation|Mandá un mensaje para arrancar/)).toHaveCount(0);
    await expect(page.getByTestId("chat-load-retry")).toBeVisible();
    // Retrying the same missing thread fails the same way, visibly.
    await page.getByTestId("chat-load-retry").click();
    await expect(page.getByTestId("chat-load-error")).toBeVisible();
  });

  test("a chat with nothing in it yet is still the empty state, not an error", async ({ page }) => {
    await page.goto(`/p/${runtime().projectId}/chat`);
    await expect(page.getByText(/Send a message to start the conversation|Mandá un mensaje para arrancar/).first()).toBeVisible();
    await expect(page.getByTestId("chat-load-error")).toHaveCount(0);
  });
});
