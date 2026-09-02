import { test, expect } from "./fixtures";

// The inbox is a SECOND AXIS. The most important thing these specs protect is
// that adding it did not take anything away from project-first navigation —
// projects as a first-class unit is what APX has that a personal assistant
// does not.
test.describe("agent inbox", () => {
  test("is reachable from the rail and renders", async ({ page, errors }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-inbox")).toBeVisible();
    await page.getByTestId("nav-inbox").click();
    await expect(page).toHaveURL(/\/inbox/);
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("survives a reload on its own URL (the SPA route is registered)", async ({ page, errors }) => {
    await page.goto("/inbox");
    await page.reload();
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("project navigation still works and is not replaced", async ({ page }) => {
    await page.goto("/inbox");
    // The project rail is still there, and still goes where it always did.
    await expect(page.getByTestId("project-avatar-0")).toBeVisible();
    await page.getByTestId("project-avatar-0").click();
    await expect(page).toHaveURL(/\/p\/0/);
  });

  test("the home rail button still reaches the admin screen", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByTestId("nav-home").click();
    await expect(page.getByTestId("screen-admin")).toBeVisible();
  });

  test("a2a conversations keep both participant avatars on desktop and mobile", async ({ page, errors }) => {
    const a2aRow = {
      project_id: 7,
      project_name: "Northwind",
      project_path: "/path/to/northwind",
      agent_slug: "ada-grace",
      agent_name: "Ada · Grace",
      agent_emoji: null,
      agent_icon: null,
      kind: "a2a",
      participants: ["ada", "grace"],
      participant_faces: [
        { name: "Ada", emoji: "🧭", icon: null },
        { name: "Grace", emoji: "⚙️", icon: null },
      ],
      requested_by: null,
      pinned: false,
      conversation_id: "conversation-example",
      channel: "a2a",
      messages: 2,
      preview: "Grace: Done.",
      last_activity_at: new Date().toISOString(),
    };
    const teammateRow = {
      ...a2aRow,
      agent_slug: "linus",
      agent_name: "Linus",
      agent_emoji: "🐧",
      kind: "agent",
      participants: undefined,
      participant_faces: undefined,
      conversation_id: "conversation-teammate",
      channel: "web",
    };

    await page.route(
      (url) => url.pathname === "/api/inbox",
      (route) => route.fulfill({ json: [a2aRow, teammateRow] }),
    );

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    await expect(page.getByTestId("a2a-avatar-group")).toHaveAttribute("data-participant-count", "2");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/m/chat");
    await expect(page.getByTestId("a2a-avatar-group")).toHaveAttribute("data-participant-count", "2");
    const avatarFitsViewport = await page
      .getByTestId("inbox-row-ada-grace")
      .getByTestId("inbox-avatar-viewport")
      .evaluate((viewport) => {
        const group = viewport.querySelector('[data-testid="a2a-avatar-group"]');
        if (!group) return false;
        const viewportBox = viewport.getBoundingClientRect();
        const groupBox = group.getBoundingClientRect();
        return groupBox.left >= viewportBox.left && groupBox.right <= viewportBox.right + 0.5;
      });
    expect(avatarFitsViewport).toBe(true);
    await expect(page.getByTestId("inbox-row-ada-grace")).toContainText("Northwind");
    expect(errors).toEqual([]);
  });

  test("the phone lists agents loose, with a way to start a new chat", async ({ page, errors }) => {
    const row = {
      project_id: 7,
      project_name: "Northwind",
      project_path: "/path/to/northwind",
      agent_slug: "linus",
      agent_name: "Linus",
      agent_emoji: "🐧",
      agent_icon: null,
      kind: "agent",
      pinned: false,
      conversation_id: "conversation-linus",
      channel: "web",
      messages: 2,
      preview: "Hi.",
      last_activity_at: new Date().toISOString(),
    };
    // Every /api/inbox call answers with this one agent, whatever the query — the
    // list is web-only and the "new chat" picker asks with include_empty.
    await page.route(
      (url) => url.pathname === "/api/inbox",
      (route) => route.fulfill({ json: [row] }),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/m/chat");
    // Agents are loose: no per-project team folder rows, just the agent.
    await expect(page.getByTestId("inbox-row-linus")).toBeVisible();

    // "New" opens the picker root (Chat / group), then the agent list.
    await page.getByTestId("mobile-new-chat").click();
    await expect(page.getByTestId("new-chat-sheet")).toBeVisible();
    await page.getByTestId("new-chat-mode-single").click();
    await expect(page.getByTestId("new-chat-linus")).toBeVisible();
    await page.getByTestId("new-chat-linus").click();
    await expect(page).toHaveURL(/\/m\/chat\/7\/linus/);
    expect(errors).toEqual([]);
  });

  // ── Channel filters ──────────────────────────────────────────────────────
  // The inbox lists every channel a conversation can happen on. Which of them
  // this DEVICE wants to see is a per-device answer (localStorage), and the
  // phone starts with Telegram off — the app is installed on that very phone.

  const CHANNEL_ROWS = [
    {
      project_id: null, project_name: null, project_path: null,
      agent_slug: "super_agent", agent_name: "APX", agent_emoji: null, agent_icon: null,
      kind: "super_agent", pinned: true, conversation_id: "2026-08-29", channel: "telegram",
      messages: 4, preview: "Listo.", preview_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    },
    {
      project_id: 7, project_name: "Northwind", project_path: "/path/to/northwind",
      agent_slug: "linus", agent_name: "Linus", agent_emoji: "🐧", agent_icon: null,
      kind: "agent", pinned: false, conversation_id: "conversation-linus", channel: "web",
      messages: 2, preview: "Hi.", preview_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    },
  ];

  test("a channel can be switched off and back on, and the choice sticks", async ({ page, errors }) => {
    await page.route(
      (url) => url.pathname === "/api/inbox",
      (route) => route.fulfill({ json: CHANNEL_ROWS }),
    );

    await page.goto("/inbox");
    // The list is flat and sorted by recency (the same shape as /m/chat), so a
    // channel switched off is a row that leaves — there are no headings left to
    // watch for.
    await expect(page.getByTestId("inbox-row-super_agent")).toBeVisible();

    await page.getByTestId("inbox-channel-filter").click();
    await page.getByTestId("inbox-channel-option-telegram").click();
    await expect(page.getByTestId("inbox-row-super_agent")).toHaveCount(0);
    // The other channel is untouched — these are switches, not one choice —
    // and the menu is still open, which is what makes it a multi-select.
    await expect(page.getByTestId("inbox-row-linus")).toBeVisible();
    await expect(page.getByTestId("inbox-channel-option-web")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.getByTestId("inbox-row-super_agent")).toHaveCount(0);

    await page.getByTestId("inbox-channel-filter").click();
    await page.getByTestId("inbox-channel-option-telegram").click();
    await expect(page.getByTestId("inbox-row-super_agent")).toBeVisible();
    expect(errors).toEqual([]);
  });

  // What the headings used to say, the row says now — on BOTH surfaces, since
  // neither list groups any more.
  test("the desktop rail tags every row with its channel", async ({ page, errors }) => {
    await page.route(
      (url) => url.pathname === "/api/inbox",
      (route) => route.fulfill({ json: CHANNEL_ROWS }),
    );
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-list").getByTestId("channel-tag-telegram")).toBeVisible();
    await expect(page.getByTestId("inbox-list").getByTestId("channel-tag-web")).toBeVisible();
    await expect(page.getByTestId("inbox-group-telegram")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the phone hides Telegram out of the box and tags every row", async ({ page, errors }) => {
    await page.route(
      (url) => url.pathname === "/api/inbox",
      (route) => route.fulfill({ json: CHANNEL_ROWS }),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/m/chat");

    // Telegram is on this device already; APX listing it again is duplication.
    await expect(page.getByTestId("inbox-row-super_agent")).toHaveCount(0);
    await expect(page.getByTestId("inbox-row-linus")).toBeVisible();
    // Nothing groups by channel any more, so the row carries it.
    await expect(page.getByTestId("channel-tag-web")).toBeVisible();

    // Two taps and it is back — a default, not a decision made for the owner.
    await page.getByTestId("mobile-channel-filter").click();
    await page.getByTestId("mobile-channel-option-telegram").click();
    await expect(page.getByTestId("inbox-row-super_agent")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("desktop inbox has + Nuevo and can open any agent", async ({ page, errors }) => {
    const row = {
      project_id: 7,
      project_name: "Northwind",
      project_path: "/path/to/northwind",
      agent_slug: "linus",
      agent_name: "Linus",
      agent_emoji: "🐧",
      agent_icon: null,
      kind: "agent",
      pinned: false,
      conversation_id: "conversation-linus",
      channel: "web",
      messages: 2,
      preview: "Hi.",
      last_activity_at: new Date().toISOString(),
    };
    await page.route(
      (url) => url.pathname === "/api/inbox",
      (route) => route.fulfill({ json: [row] }),
    );

    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-new-chat")).toBeVisible();
    await page.getByTestId("inbox-new-chat").click();
    await expect(page.getByTestId("new-chat-sheet")).toBeVisible();
    await page.getByTestId("new-chat-mode-single").click();
    await expect(page.getByTestId("new-chat-linus")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
