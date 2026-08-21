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
    await expect(page).toHaveURL(/\/m\/inbox/);
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("survives a reload on its own URL (the SPA route is registered)", async ({ page, errors }) => {
    await page.goto("/m/inbox");
    await page.reload();
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("project navigation still works and is not replaced", async ({ page }) => {
    await page.goto("/m/inbox");
    // The project rail is still there, and still goes where it always did.
    await expect(page.getByTestId("project-avatar-0")).toBeVisible();
    await page.getByTestId("project-avatar-0").click();
    await expect(page).toHaveURL(/\/p\/0/);
  });

  test("the home rail button still reaches the admin screen", async ({ page }) => {
    await page.goto("/m/inbox");
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

    await page.goto("/m/inbox");
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    await expect(page.getByTestId("a2a-avatar-group")).toHaveAttribute("data-participant-count", "2");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/mobile");
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

    await page.goto("/mobile/team/7");
    await expect(page.getByTestId("inbox-row-ada-grace").getByTestId("a2a-avatar-group"))
      .toHaveAttribute("data-participant-count", "2");
    expect(errors).toEqual([]);
  });
});
