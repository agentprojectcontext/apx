import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

// The phone stopped being one screen. It is now three — chats, tasks, promises
// — reached by a bottom bar, and the whole surface moved from `/mobile` to
// `/m/…` to make room for that.
//
// Every list here is CROSS-PROJECT: the panel hangs tasks off a project because
// that is where they are stored, but nobody standing in a queue thinks "let me
// check repo 7". Both screens are stubbed at the global endpoints for that
// reason — a spec that stubbed `/api/projects/:pid/tasks` would be testing a
// call this screen never makes.

const PHONE = { width: 390, height: 844 };

const TASKS = [
  {
    id: "t_late", state: "open", status: "pending", title: "Pagar el proveedor",
    body: "antes del viernes", tags: [], due: "2020-01-01", agent: null, source: null,
    project_id: 0, project_name: "default",
    created_at: "2026-08-30T10:00:00.000Z", updated_at: "2026-08-30T10:00:00.000Z",
  },
  {
    id: "t_none", state: "open", status: "pending", title: "Mirar el informe",
    body: null, tags: [], due: null, agent: null, source: null,
    project_id: 0, project_name: "default",
    created_at: "2026-08-29T10:00:00.000Z", updated_at: "2026-08-29T10:00:00.000Z",
  },
];

const COMMITMENTS = [
  {
    id: "c_ana", state: "open", counterparty: "Ana", body: "mandar el presupuesto",
    promised_at: "2026-08-20T10:00:00.000Z", due: "2020-01-01",
    origin_channel: null, origin_message_ref: null, history: [],
    project_id: 0, project_name: "default",
    created_at: "2026-08-20T10:00:00.000Z", updated_at: "2026-08-20T10:00:00.000Z",
  },
];

/** Both global lists, in the paged envelope the screens unwrap. */
async function stubLists(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/tasks",
    (route) => route.fulfill({ json: { data: TASKS, meta: { total: TASKS.length } } }),
  );
  await page.route(
    (url) => url.pathname === "/api/commitments",
    (route) => route.fulfill({ json: { data: COMMITMENTS, meta: { total: COMMITMENTS.length } } }),
  );
}

test.describe("phone tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await stubLists(page);
  });

  test("the bar moves between the three surfaces", async ({ page, errors }) => {
    await page.goto("/m/chat");
    await expect(page.getByTestId("mobile-tabbar")).toBeVisible();

    await page.getByTestId("mobile-tab-tasks").click();
    await expect(page).toHaveURL(/\/m\/tasks/);
    await expect(page.getByTestId("mobile-task-list")).toBeVisible();

    await page.getByTestId("mobile-tab-commitments").click();
    await expect(page).toHaveURL(/\/m\/commitments/);
    await expect(page.getByTestId("mobile-commitment-list")).toBeVisible();

    await page.getByTestId("mobile-tab-chats").click();
    await expect(page).toHaveURL(/\/m\/chat/);
    expect(errors, "no uncaught page errors").toEqual([]);
  });

  // The whole point of the tab bar is one thumb. Inside a chat the screen ends
  // in a composer, and a nav bar under it would sit exactly where send goes.
  test("a chat is full screen — no bar over the composer", async ({ page }) => {
    await page.goto("/m/chat/0/roby");
    await expect(page.getByTestId("mobile-tabbar")).toHaveCount(0);
  });

  test("tasks group by when they are due, and one opens", async ({ page, errors }) => {
    await page.goto("/m/tasks");
    // Grouped by WHEN, not by which project they came from.
    await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
    await expect(page.getByText("No date", { exact: true })).toBeVisible();

    await page.getByTestId("mobile-task-t_late").click();
    const sheet = page.getByTestId("mobile-task-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Pagar el proveedor")).toBeVisible();
    // The verbs are the reason the sheet exists.
    await expect(page.getByTestId("mobile-task-done")).toBeVisible();
    await expect(page.getByTestId("mobile-task-drop")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a promise opens with its four verbs, and rescheduling asks for a date", async ({ page, errors }) => {
    await page.goto("/m/commitments");
    await page.getByTestId("mobile-commitment-c_ana").click();
    const sheet = page.getByTestId("mobile-commitment-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("mobile-commitment-kept")).toBeVisible();
    await expect(page.getByTestId("mobile-commitment-missed")).toBeVisible();
    await expect(page.getByTestId("mobile-commitment-drop")).toBeVisible();

    // The store refuses a renegotiation with no date ("moved it, no idea until
    // when" is how a promise disappears), so the date IS the action.
    await page.getByTestId("mobile-commitment-move").click();
    await expect(page.getByTestId("mobile-commitment-move-date")).toHaveValue("2020-01-01");
    await expect(page.getByTestId("mobile-commitment-move-confirm")).toBeVisible();
    expect(errors).toEqual([]);
  });

  // Reported live, the first evening the tab bar existed: completing a task
  // showed "• Hecha" in the bottom-right corner — exactly on top of the tabs.
  // A toast must never cover the control that raised it.
  test("a toast lands clear of the tab bar, not on top of it", async ({ page, errors }) => {
    await page.route(
      (url) => url.pathname === "/api/projects/0/tasks/t_late/done",
      (route) => route.fulfill({ json: { ...TASKS[0], state: "done" } }),
    );

    await page.goto("/m/tasks");
    await page.getByTestId("mobile-task-t_late").click();
    await page.getByTestId("mobile-task-done").click();

    const toast = page.getByTestId("toast-stack");
    await expect(toast).toBeVisible();
    const stack = await toast.boundingBox();
    const bar = await page.getByTestId("mobile-tabbar").boundingBox();
    expect(stack, "the toast stack is on screen").not.toBeNull();
    expect(bar, "the tab bar is on screen").not.toBeNull();
    // Entirely above the bar — measured, not asserted from the class string,
    // because what matters is where it lands, not how it was spelled.
    expect(stack!.y + stack!.height).toBeLessThanOrEqual(bar!.y);
    expect(errors).toEqual([]);
  });

  // The links are out in the world and cannot be recalled: the Android shell
  // hardcodes `/mobile`, and printed QR codes carry it.
  test("the phone's old address still lands", async ({ page }) => {
    await page.goto("/mobile");
    await expect(page).toHaveURL(/\/m\/chat/);
    await page.goto("/mobile/chat/0/roby");
    await expect(page).toHaveURL(/\/m\/chat\/0\/roby/);
  });
});

// The panel's own modules moved OUT of /m when the phone moved in.
test.describe("panel modules after the move", () => {
  test("the old module paths redirect to the short ones", async ({ page }) => {
    await page.goto("/m/inbox");
    await expect(page).toHaveURL(/\/inbox$/);
    // With the query intact — /code?pid=..&edit=.. is a real handoff from the
    // project Artifacts tab, and a redirect that dropped it would open nothing.
    await page.goto("/m/code?pid=0&cmd=hello");
    await expect(page).toHaveURL(/\/code(\?|$)/);
  });
});
