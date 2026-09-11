import { test, expect } from "./fixtures";

// The switcher under the agent's name answers ONE question: which other session
// of THIS conversation do you want. It used to answer a different one.
//
// It was scoped by the SURFACE, and every surface got it wrong. The inbox
// passed "web", so opening a WhatsApp thread listed web sessions and the thread
// you were reading was not in its own switcher. The phone passed nothing to
// escape that, so opening one person's WhatsApp offered every thread APX has —
// Telegram days, the log, the CLI, and four other people's conversations, in
// one menu.
//
// Scope belongs to the thread, not the frame around it.

const TODAY = "2026-09-11";

/** One person's WhatsApp day. `contact_person` is the daemon's answer to "which
 *  human" — see the third one: the same person, written from another address. */
const thread = (over: Record<string, unknown>) => ({
  channel: "whatsapp",
  messages: 3,
  started_at: `${TODAY}T10:00:00Z`,
  last_ts: `${TODAY}T11:00:00Z`,
  ...over,
});

const ANA = "5551000001@lid";
const BRUNO = "5552000002@lid";

const THREADS = [
  thread({ id: `${TODAY}~${ANA}`, contact: ANA, contact_person: ANA, contact_name: "Ana Rivas", title: "Ana Rivas" }),
  thread({ id: `2026-09-10~${ANA}`, contact: ANA, contact_person: ANA, contact_name: "Ana Rivas", title: "Ana Rivas" }),
  // Ana again, from her other line. The ledger records the address a message
  // arrived from; the roster knows both are her, and the daemon resolves it.
  thread({
    id: "2026-09-09~5551000001@example.net",
    contact: "5551000001@example.net",
    contact_person: ANA,
    contact_name: "Ana Rivas",
    title: "Ana Rivas",
  }),
  thread({ id: `${TODAY}~${BRUNO}`, contact: BRUNO, contact_person: BRUNO, contact_name: "Bruno Sosa", title: "Bruno Sosa" }),
  thread({ id: TODAY, channel: "telegram", title: "Buenas" }),
  thread({ id: TODAY, channel: "log", title: "Nada cruza el umbral" }),
];

const INBOX_ROW = {
  project_id: null,
  project_name: null,
  project_path: null,
  agent_slug: "super_agent",
  agent_name: "Ana Rivas",
  agent_emoji: null,
  agent_icon: null,
  kind: "super_agent",
  contact: ANA,
  contact_name: "Ana Rivas",
  contact_person: ANA,
  pinned: true,
  conversation_id: `${TODAY}~${ANA}`,
  channel: "whatsapp",
  messages: 3,
  preview: "Listo.",
  last_activity_at: `${TODAY}T11:00:00Z`,
};

async function routeAll(page: import("@playwright/test").Page) {
  await page.route(
    (url) => url.pathname === "/api/inbox",
    (route) => route.fulfill({ json: [INBOX_ROW] }),
  );
  await page.route(
    (url) => url.pathname.endsWith("/super-agent/threads"),
    (route) => route.fulfill({ json: THREADS }),
  );
  // The open thread itself, so the pane has something to draw and the header
  // does not sit on a 404.
  await page.route(
    (url) => url.pathname.includes("/super-agent/threads/"),
    (route) =>
      route.fulfill({
        json: {
          id: `${TODAY}~${ANA}`,
          channel: "whatsapp",
          contact: ANA,
          contact_person: ANA,
          contact_name: "Ana Rivas",
          title: "Ana Rivas",
          messages: [{ role: "user", content: "Hola", ts: `${TODAY}T10:00:00Z` }],
        },
      }),
  );
}

/** What the open menu is offering, by thread id. */
async function optionIds(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator("[data-testid^='session-option-']").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.testid!.replace("session-option-", "")),
  );
}

test.describe("session switcher", () => {
  test("one person's WhatsApp offers their days — not everyone's, not every channel", async ({ page, errors }) => {
    await routeAll(page);
    await page.goto("/inbox");
    await page.getByTestId("inbox-row-super_agent").click();

    await page.getByTestId("session-picker").click();
    await expect(page.getByTestId(`session-option-whatsapp:${TODAY}~${ANA}`)).toBeVisible();

    const ids = await optionIds(page);
    // Ana's three days, including the one she wrote from her other address —
    // the ledger keeps the address, the roster knows it is one person, and a
    // switcher that compared raw keys would show two thirds of her history
    // while looking complete.
    expect(ids.sort()).toEqual([
      `whatsapp:2026-09-09~5551000001@example.net`,
      `whatsapp:2026-09-10~${ANA}`,
      `whatsapp:${TODAY}~${ANA}`,
    ].sort());
    // And nothing else: not the other person on the same channel, not the
    // Telegram day, not the log.
    expect(ids).not.toContain(`whatsapp:${TODAY}~${BRUNO}`);
    expect(ids.some((id) => id.startsWith("telegram:") || id.startsWith("log:"))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("each row says which DAY it is, since every one is titled with the person", async ({ page, errors }) => {
    await routeAll(page);
    await page.goto("/inbox");
    await page.getByTestId("inbox-row-super_agent").click();
    await page.getByTestId("session-picker").click();

    // Every session of one person's conversation carries that person's name, so
    // the label alone cannot tell two of them apart.
    const row = page.getByTestId(`session-option-whatsapp:2026-09-10~${ANA}`);
    await expect(row).toContainText("Ana Rivas");
    await expect(row).toContainText("2026-09-10");
    expect(errors).toEqual([]);
  });

  test("the phone's switcher is scoped the same way", async ({ page, errors }) => {
    await routeAll(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/m/chat");
    // WhatsApp is on by default on the phone; only Telegram starts muted.
    await page.getByTestId("inbox-row-super_agent").click();

    await page.getByTestId("session-picker").click();
    // The list is fetched when the menu is reached for, so wait for it to land
    // before reading it — an empty menu would pass a "nothing else is here" test
    // for the wrong reason.
    await expect(page.getByTestId(`session-option-whatsapp:${TODAY}~${ANA}`)).toBeVisible();
    const ids = await optionIds(page);
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => id.startsWith("whatsapp:"))).toBe(true);
    expect(errors).toEqual([]);
  });
});
