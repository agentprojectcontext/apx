import { test, expect } from "./fixtures";

// Work an agent left running, and the chat it belongs to.
//
// THE FAILURE, 2026-09-14. The count existed and the CONNECTION did not. A row
// said "Roby is waiting on magui" at the very top of the window and did not say
// which project, which chat, or how to get there — and the chat it came from
// said nothing at all. Manu, reading both at once: "arriba se ve la tarea pero
// no se entiende bien, no dice de qué chat viene… la tarea la ejecutó en un
// chat, debería aparecer en ese chat arriba donde ahora están los botones de
// tool y abrir en el proyecto… y en el listado de chats, así como mostramos el
// loading y el punto azul, podría mostrarse algún loading de tarea."
//
// Three places, one fact, and each one is asserted below: the global panel (for
// chats you are NOT reading), the thread header (for the one you are), and the
// list row (so you can tell a peer ten minutes into a job from a thread nothing
// has touched since yesterday).

const THREAD = "nati~super_agent";

const job = {
  id: "bgjob_spec01",
  project_id: 7,
  from: "super_agent",
  to: "nati",
  thread: THREAD,
  body: "Check the deploy and report back.",
  wake: true,
  depth: 0,
  status: "running",
  created_at: new Date().toISOString(),
  deadline_at: new Date(Date.now() + 3_600_000).toISOString(),
  timeout_s: 3600,
  closed_at: null,
  result: null,
};

const a2aRow = {
  project_id: 7,
  project_name: "Northwind",
  project_path: "/path/to/northwind",
  agent_slug: `a2a:${THREAD}`,
  agent_name: "Nati · Roby",
  agent_emoji: null,
  agent_icon: null,
  kind: "a2a",
  participants: ["nati", "super_agent"],
  participant_faces: [{ name: "Nati", emoji: "🧭", icon: null }, { name: "Roby", emoji: "⚙️", icon: null }],
  requested_by: null,
  pinned: false,
  conversation_id: THREAD,
  channel: "a2a",
  messages: 2,
  preview: "Roby: dale, avisame.",
  last_activity_at: new Date().toISOString(),
  active_turn: null,
};

/** A second conversation with no job on it — the control. A mark that appears
 *  on every row says nothing at all. */
const quietRow = {
  ...a2aRow,
  agent_slug: "a2a:april~super_agent",
  agent_name: "April · Roby",
  conversation_id: "april~super_agent",
  preview: "April: listo.",
};

async function stub(page: import("@playwright/test").Page, jobs: unknown[]) {
  // The roster too, and not as belt-and-braces: a job record carries a project
  // ID and no name, so the panel MUST resolve it — which is the whole point of
  // the assertion below. Stubbed, the test says what it means; unstubbed, it
  // quietly read whichever project happens to be #7 on the machine running it.
  await page.route((url) => url.pathname === "/api/projects", (route) =>
    route.fulfill({
      json: [
        { id: 0, name: "default", path: "/path/to/default", kind: "default", agents: 1, apx_id: "default", storage_path: "/path/to/default" },
        { id: 7, name: "Northwind", path: "/path/to/northwind", kind: "company", agents: 2, apx_id: "northwind0001", storage_path: "/path/to/northwind" },
      ],
    }));
  await page.route((url) => url.pathname === "/api/inbox", (route) =>
    route.fulfill({ json: [a2aRow, quietRow] }));
  await page.route((url) => url.pathname === "/api/jobs", (route) =>
    route.fulfill({ json: { data: jobs, meta: { total: jobs.length, open: jobs.length } } }));
}

test.describe("background jobs", () => {
  test("nothing running draws no chip anywhere — the appearance IS the news", async ({ page, errors }) => {
    await stub(page, []);
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    // A permanent "0 jobs" control is furniture.
    await expect(page.getByTestId("background-jobs")).toHaveCount(0);
    await expect(page.getByTestId("thread-jobs")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the global panel names the project and opens the chat", async ({ page, errors }) => {
    await stub(page, [job]);
    await page.goto("/inbox");
    await page.getByTestId("background-jobs").click();

    // Who is waiting on whom, WHERE it is happening, and what was asked. The
    // project is the half that was missing: the global panel spans every
    // project at once, so without it a row is two agent names floating free.
    const row = page.getByTestId(`open-job-${job.id}`);
    await expect(row).toContainText("super_agent");
    await expect(row).toContainText("nati");
    await expect(row).toContainText("Northwind");
    await expect(row).toContainText("Check the deploy");

    // And it is a way IN, not just a status line. Hunting through the sidebar
    // for a pair of names is the step this panel was supposed to remove.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`thread=${encodeURIComponent(THREAD)}`));
    expect(errors).toEqual([]);
  });

  test("the thread that owns the job says so in its own header", async ({ page, errors }) => {
    await stub(page, [job]);
    await page.goto(`/inbox?channel=a2a&thread=${encodeURIComponent(THREAD)}`);
    // Beside the tools toggle and "Open in project" — where somebody reading
    // the conversation actually looks, rather than at the top of the window.
    const chip = page.getByTestId("thread-jobs");
    await expect(chip).toBeVisible();
    // In a header a bare count is a mystery glyph next to a wrench; the word is
    // what makes it a status.
    await expect(chip).toContainText(/tarea|task/i);
    // Same panel, one tap away — not a second, smaller rendering of the truth.
    await chip.click();
    await expect(page.getByTestId(`cancel-job-${job.id}`)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a thread with no job of its own keeps its header clean", async ({ page }) => {
    await stub(page, [job]);
    await page.goto("/inbox?channel=a2a&thread=april~super_agent");
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    // Scoped to the thread, not to the project: the job is Nati's, and April's
    // header must not claim it. The global count still stands, because that one
    // is precisely about chats you are not reading.
    await expect(page.getByTestId("thread-jobs")).toHaveCount(0);
    await expect(page.getByTestId("background-jobs")).toBeVisible();
  });

  test("the list row marks the chat where work is running, and only that one", async ({ page }) => {
    await stub(page, [job]);
    await page.goto("/inbox");
    const running = page.getByTestId(`inbox-row-a2a:${THREAD}`).getByRole("status");
    await expect(running).toHaveAttribute("aria-label", /tarea|task/i);
    // The control. Without it this test would pass on a mark drawn everywhere.
    await expect(
      page.getByTestId("inbox-row-a2a:april~super_agent").getByRole("status"),
    ).toHaveCount(0);
  });

  test("a deep link re-selects even when a chat is already open", async ({ page }) => {
    // This was a first-paint-only feature: the inbox bailed if anything was
    // selected, so navigating to a thread from inside the inbox changed the
    // address bar and nothing else — which is the common case for "open the
    // chat", not the rare one.
    await stub(page, [job]);
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    await page.goto(`/inbox?channel=a2a&thread=${encodeURIComponent(THREAD)}`);
    await expect(page.getByTestId("thread-jobs")).toBeVisible();
  });
});
