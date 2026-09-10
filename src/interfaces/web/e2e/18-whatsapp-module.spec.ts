import { test, expect } from "./fixtures";

// WhatsApp earns a rail entry because of what it is used FOR: a roster of
// people who write all day, and a decision ("do we answer them?") somebody is
// waiting on. Three clicks deep in Settings is the wrong place for that, and
// the conversations are listed on the same page so opening it answers both
// "who wrote?" and "who is this?".
//
// The requests contacts make used to be a tab of their own — one click away and
// therefore unread. They are on top of the roster now, and the count that says
// there is a reason to look rides on the Contacts tab itself.

test.describe("whatsapp module", () => {
  test("the rail opens it, and it carries the chats and the roster", async ({ page, errors }) => {
    await page.goto("/");
    await page.getByTestId("module-avatar-whatsapp").click();
    await expect(page).toHaveURL(/\/whatsapp/);
    await expect(page.getByTestId("screen-whatsapp")).toBeVisible();

    // Its own conversations, not every channel's.
    await expect(page.getByRole("heading", { name: /whatsapp chats|chats de whatsapp/i })).toBeVisible();
    // The same panel Settings has — same component, one click instead of three.
    await expect(page.getByRole("tab", { name: /contacts|contactos/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /stickers|figuritas/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("pending requests live inside Contacts now, and the old link still lands", async ({ page, errors }) => {
    // A tab that no longer exists: the deep link has been handed out in docs and
    // in messages, so it opens the page that now holds them.
    await page.goto("/settings/whatsapp?tab=pending");
    await expect(page.getByRole("tab", { name: /contacts|contactos/i })).toHaveAttribute("data-state", "active");
    expect(errors).toEqual([]);
  });
});
