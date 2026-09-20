import { test, expect } from "./fixtures";

// The timeline: what a long chat has actually been through.
//
// THE PROBLEM, 2026-09-18. A chat where something real got built is unreadable
// afterwards — forty turns, hundreds of tool calls, and "where did the reel end
// up" buried in the middle. And separately, from a stranger on TikTok: nothing
// tells anybody when something failed or was left half-finished. Those turned
// out to be one feature. A rail of steps, each carrying an outcome, answers the
// first; the outcomes answer the second.
//
// What is asserted here is the part that is easy to get wrong in the UI rather
// than in core (which has its own tests): the rail EARNS its space or does not
// take any, a failure is legible without opening anything, and the cross-chat
// view can be narrowed to the rows somebody still has to act on.

const PROJECTS = [
  { id: 0, name: "default", path: "/path/to/default", kind: "default", agents: 1, apx_id: "default", storage_path: "/path/to/default" },
  { id: 7, name: "Northwind", path: "/path/to/northwind", kind: "company", agents: 2, apx_id: "northwind0001", storage_path: "/path/to/northwind" },
];

const step = (over: Record<string, unknown> = {}) => ({
  kind: "derived",
  title: "Make the reel",
  state: "done",
  started_at: "2026-09-18T10:00:00Z",
  ended_at: "2026-09-18T10:30:00Z",
  answered: true,
  tools: { total: 4, failed: 0, names: ["run_shell"] },
  agent: "Magui",
  model: "anthropic:claude",
  channel: "web",
  conversation_id: "c1",
  milestones: [],
  ...over,
});

function statsFor(entries: { state: string }[]) {
  const count = (name: string) => entries.filter((e) => e.state === name).length;
  return {
    total: entries.length,
    open: count("open"),
    done: count("done"),
    failed: count("failed"),
    superseded: count("superseded"),
    running: count("running"),
  };
}

async function stubTimeline(page: import("@playwright/test").Page, entries: unknown[]) {
  await page.route((url) => url.pathname === "/api/projects", (route) =>
    route.fulfill({ json: PROJECTS }));
  await page.route(
    (url) => url.pathname.endsWith("/milestones"),
    (route) => route.fulfill({ json: { entries, stats: statsFor(entries as { state: string }[]) } }),
  );
}

test.describe("timeline", () => {
  test("a project with unfinished work says so before anything is opened", async ({ page, errors }) => {
    await stubTimeline(page, [
      step(),
      step({ title: "Upload the recap", state: "open", answered: false, started_at: "2026-09-18T11:00:00Z", tools: { total: 1, failed: 0, names: [] } }),
    ]);
    await page.goto("/p/7");

    const timeline = page.getByTestId("project-timeline");
    await expect(timeline).toBeVisible();

    // The header carries the two numbers worth interrupting for, so a reader
    // who needs nothing else never opens the rail.
    const rail = page.getByTestId("milestone-rail");
    await expect(rail).toBeVisible();
    await expect(rail).toContainText("2 steps");
    await expect(rail).toContainText("1 open");

    // Open by default here — unlike inside a chat, this view IS the content.
    await expect(page.getByTestId("milestone-row")).toHaveCount(2);
    await expect(page.getByTestId("milestone-row").nth(1)).toHaveText(/Never answered/);
    expect(errors).toHaveLength(0);
  });

  // WHAT "OPEN" HAD COME TO MEAN. Measured across 372 real conversations: of 39
  // unanswered steps, 28 were closed by another message from the same person and
  // 11 of those were the identical text sent again. An alarm count that is
  // mostly "you pressed send twice" is one people stop reading — so these two
  // states exist to keep it out of the count without hiding the rows.
  test("a request its sender replaced is shown, greyed, and not an alarm", async ({ page }) => {
    await stubTimeline(page, [
      step({ title: "podes ver el mcp?", state: "superseded", answered: false, superseded_reason: "repeated", tools: { total: 0, failed: 0, names: [] } }),
      step({ title: "podes ver el mcp?", started_at: "2026-09-18T10:00:07Z" }),
    ]);
    await page.goto("/p/7");

    const rail = page.getByTestId("milestone-rail");
    await expect(rail).toContainText("2 steps");
    await expect(rail).not.toContainText("open");
    await expect(page.getByTestId("milestone-row")).toHaveCount(2);
    await expect(page.getByTestId("milestone-row").first()).toHaveAttribute("data-milestone-state", "superseded");
    await expect(page.getByTestId("milestone-row").first()).toHaveText(/Sent twice/);
  });

  test("a request replaced seconds after it was sent says which of the two it was", async ({ page }) => {
    await stubTimeline(page, [
      step({ title: "corre una tool de timing", state: "superseded", answered: false, superseded_reason: "replaced", tools: { total: 0, failed: 0, names: [] } }),
      step({ title: "contame qué es APX", started_at: "2026-09-18T10:00:05Z" }),
    ]);
    await page.goto("/p/7");
    await expect(page.getByTestId("milestone-row").first()).toHaveText(/You replaced this/);
  });

  // A turn in flight is not abandoned work. The request is on disk before the
  // model is called, so from the file alone the chat being answered right now
  // and one the daemon died inside look the same — which is how the panel came
  // to announce "never answered" over the request it was busy answering.
  test("a turn being written says so instead of reading as never answered", async ({ page }) => {
    await stubTimeline(page, [
      step(),
      step({ title: "Upload the recap", state: "running", answered: false, started_at: "2026-09-18T11:00:00Z", tools: { total: 1, failed: 0, names: [] } }),
    ]);
    await page.goto("/p/7");

    const rail = page.getByTestId("milestone-rail");
    await expect(rail).toContainText("Working on it");
    await expect(rail).not.toContainText("open");

    const row = page.getByTestId("milestone-row").nth(1);
    await expect(row).toHaveAttribute("data-milestone-state", "running");
    await expect(row).not.toHaveText(/Never answered/);
  });

  // The precedence that had to be spelled out: an agent declares its steps as it
  // goes, so a turn in progress ALWAYS carries open milestones. Letting those
  // report upward is exactly the bug.
  test("a running turn stays running even with its own steps still open", async ({ page }) => {
    // Two rows, because a rail with one uneventful step draws nothing at all —
    // that rule is asserted on its own below and is not what this is about.
    await stubTimeline(page, [
      step({ title: "Write the caption" }),
      step({
        title: "Render the reel",
        state: "running",
        answered: false,
        started_at: "2026-09-18T11:00:00Z",
        milestones: [{ id: "m1", state: "open", title: "Rendering", track: "Reel", detail: null, started_at: "2026-09-18T11:05:00Z", updated_at: "2026-09-18T11:05:00Z", closed_at: null, note: null, channel: "web", conversation_id: "c1", agent: "magui" }],
      }),
    ]);
    await page.goto("/p/7");
    await expect(page.getByTestId("milestone-row").nth(1)).toHaveAttribute("data-milestone-state", "running");
    await expect(page.getByTestId("milestone-declared")).toHaveCount(1);
    // The declared row keeps its own amber dot — the step is what is running,
    // not everything inside it.
    await expect(page.getByTestId("milestone-rail")).not.toContainText("1 open");
  });

  test("a failed step reads as failed without opening anything", async ({ page }) => {
    await stubTimeline(page, [
      step({ title: "Publish to TikTok", state: "failed", tools: { total: 6, failed: 2, names: ["run_shell"] } }),
      step({ title: "Write the caption", started_at: "2026-09-18T12:00:00Z" }),
    ]);
    await page.goto("/p/7");
    await expect(page.getByTestId("milestone-rail")).toContainText("1 failed");
    await expect(page.getByTestId("milestone-row").first()).toHaveAttribute("data-milestone-state", "failed");
  });

  // The declared half: a step the agent recorded itself hangs under the request
  // that produced it, and a declared failure overrides a request that otherwise
  // answered cleanly — the agent is the more specific witness.
  test("a declared failure beats a turn that looks fine", async ({ page }) => {
    await stubTimeline(page, [
      step({
        title: "Render and upload",
        state: "done",
        milestones: [
          { id: "m_1", state: "failed", title: "Upload", track: "September reel", note: "no credentials", started_at: "2026-09-18T10:20:00Z" },
        ],
      }),
      step({ title: "Second thing", started_at: "2026-09-18T13:00:00Z" }),
    ]);
    await page.goto("/p/7");
    await expect(page.getByTestId("milestone-declared")).toHaveCount(1);
    await expect(page.getByTestId("milestone-declared")).toContainText("no credentials");
    await expect(page.getByTestId("milestone-row").first()).toHaveAttribute("data-milestone-state", "failed");
  });

  test("unfinished-only narrows to the rows somebody still has to act on", async ({ page }) => {
    await stubTimeline(page, [
      step({ title: "Done thing" }),
      step({ title: "Stalled thing", state: "open", answered: false, started_at: "2026-09-18T11:00:00Z" }),
    ]);
    await page.goto("/p/7");
    await expect(page.getByTestId("milestone-row")).toHaveCount(2);

    await page.getByTestId("timeline-unfinished").click();
    await expect(page.getByTestId("milestone-row")).toHaveCount(1);
    await expect(page.getByTestId("milestone-row")).toContainText("Stalled thing");
    // The header follows the filter: a count describing rows other than the
    // ones underneath it is worse than no count.
    await expect(page.getByTestId("milestone-rail")).toContainText("1 step");
  });

  test("nothing in the range says so, rather than drawing an empty rail", async ({ page }) => {
    await stubTimeline(page, []);
    await page.goto("/p/7");
    await expect(page.getByTestId("project-timeline")).toContainText("Nothing recorded");
    await expect(page.getByTestId("milestone-rail")).toHaveCount(0);
  });

  // The rail costs space, so it has to earn it. One request that went fine is
  // the answer sitting right there on the screen; a rail describing it is
  // furniture.
  test("a single clean step draws no rail at all", async ({ page }) => {
    await stubTimeline(page, [step()]);
    await page.goto("/p/7");
    await expect(page.getByTestId("project-timeline")).toBeVisible();
    await expect(page.getByTestId("milestone-rail")).toHaveCount(0);
  });

  // A real week came back 85 steps long. That is not a summary of anything — it
  // is the transcript again in a different shape, pushing the rest of the page
  // off the bottom. The Overview shows the newest handful and hands the rest to
  // the screen built for it.
  test("the glance is capped, and says how many it is not showing", async ({ page }) => {
    const many = Array.from({ length: 24 }, (_, i) =>
      step({ title: `Step ${i + 1}`, started_at: `2026-09-18T${String(i % 24).padStart(2, "0")}:00:00Z` }),
    );
    await stubTimeline(page, many);
    await page.goto("/p/7");
    await expect(page.getByTestId("milestone-row")).toHaveCount(10);
    // The NEWEST ten, not the oldest: a timeline reads forward, so a cap taken
    // off the front would hide today and show last week.
    await expect(page.getByTestId("milestone-row").last()).toContainText("Step 24");
    await expect(page.getByTestId("timeline-view-all")).toContainText("14 more");
  });

  test("view all lands on the screen that shows the lot", async ({ page }) => {
    const many = Array.from({ length: 24 }, (_, i) =>
      step({ title: `Step ${i + 1}`, started_at: `2026-09-18T${String(i % 24).padStart(2, "0")}:00:00Z` }),
    );
    await stubTimeline(page, many);
    await page.goto("/p/7");
    await page.getByTestId("timeline-view-all").click();
    await expect(page).toHaveURL(/\/p\/7\/timeline$/);
    await expect(page.getByTestId("milestone-row")).toHaveCount(24);
    // Nothing left to send you anywhere: this screen IS all of it.
    await expect(page.getByTestId("timeline-view-all")).toHaveCount(0);
  });

  // The question a reader has the moment they spot a step that failed is "which
  // conversation was that". Without the link the answer is "go and find it".
  test("a step links to the chat it happened in", async ({ page }) => {
    await stubTimeline(page, [
      step({ title: "Rendered the reel", conversation_id: "2026-09-18-01", agent_slug: "magui" }),
      step({ title: "Stalled thing", state: "open", answered: false, started_at: "2026-09-18T11:00:00Z", conversation_id: "2026-09-18-02", agent_slug: "magui" }),
    ]);
    await page.goto("/p/7/timeline");
    await page.getByTestId("milestone-open-chat").first().click();
    await expect(page).toHaveURL(/\/p\/7\/chat\?agent=magui&conv=2026-09-18-01$/);
  });

  // A guess is worse than no link: a step with no conversation to open would
  // otherwise take the reader to somebody else's chat.
  test("a step with nowhere to go is not a link", async ({ page }) => {
    await stubTimeline(page, [
      step({ title: "No conversation", conversation_id: null, agent_slug: null }),
      step({ title: "Stalled thing", state: "open", answered: false, started_at: "2026-09-18T11:00:00Z", conversation_id: null, agent_slug: null }),
    ]);
    await page.goto("/p/7/timeline");
    await expect(page.getByTestId("milestone-row")).toHaveCount(2);
    await expect(page.getByTestId("milestone-open-chat")).toHaveCount(0);
  });

  // The timeline has three homes and they answer different questions: a glance
  // on the Overview, a place of its own to work in, and — inside a chat — the
  // thing you read AGAINST the messages that produced it.
  test("it has a place of its own in the project menu", async ({ page }) => {
    await stubTimeline(page, [
      step(),
      step({ title: "Stalled thing", state: "open", answered: false, started_at: "2026-09-18T11:00:00Z" }),
    ]);
    await page.goto("/p/7/timeline");
    await expect(page.getByTestId("project-timeline")).toBeVisible();
    await expect(page.getByTestId("milestone-rail")).toContainText("1 open");
  });

  test("a chat opens it beside the conversation, and closes it again", async ({ page }) => {
    await stubTimeline(page, [
      step(),
      step({ title: "Stalled thing", state: "open", answered: false, started_at: "2026-09-18T11:00:00Z" }),
    ]);
    await page.goto("/p/7/chat");

    const toggle = page.getByTestId("chat-timeline-toggle");
    await expect(toggle).toBeVisible();
    // Closed, this is the only thing that says there is something to look at —
    // so the count rides on it as a badge. A badge and not text inside the
    // button, because the header is one strip of same-sized controls and a
    // wider one there is what the sizing rules exist to prevent.
    await expect(page.getByTestId("chat-timeline-badge")).toHaveText("1");
    await expect(page.getByTestId("chat-timeline-panel")).toHaveCount(0);

    await toggle.click();
    const panel = page.getByTestId("chat-timeline-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Stalled thing");
    // Beside the conversation, not over it: the transcript stays readable, which
    // is the whole reason this is a side panel and not a dialog.
    const share = await panel.evaluate(
      (el) => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width,
    );
    expect(share).toBeLessThan(0.6);

    await page.getByTestId("chat-timeline-close").click();
    await expect(page.getByTestId("chat-timeline-panel")).toHaveCount(0);
  });

  // Below the two-column breakpoint there is no room for a side panel, so the
  // same component covers the conversation instead and is dismissed with the X.
  //
  // Asserted at 700px rather than at a phone's 390: this screen puts the chat
  // LIST beside the thread, and at 390 the list takes the width and the thread
  // pane has none — nothing to cover. The phone surface (/m/chat, which is what
  // the APK loads) hides that list, so the thread has the full width and this
  // same rule applies; what is pinned here is the rule.
  test("below the two-column width it covers the conversation, and the X closes it", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 780 });
    await stubTimeline(page, [
      step(),
      step({ title: "Stalled thing", state: "open", answered: false, started_at: "2026-09-18T11:00:00Z" }),
    ]);
    await page.goto("/p/7/chat");

    await page.getByTestId("chat-timeline-toggle").click();
    const panel = page.getByTestId("chat-timeline-panel");
    await expect(panel).toBeVisible();
    // The contract is "it covers its container", not any particular number of
    // pixels — measured against the pane it sits in, so the assertion does not
    // move every time the chat list changes width.
    const share = await panel.evaluate(
      (el) => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width,
    );
    expect(share).toBeGreaterThan(0.95);

    await page.getByTestId("chat-timeline-close").click();
    await expect(page.getByTestId("chat-timeline-panel")).toHaveCount(0);
  });

  // A panel somebody OPENED must not decide there was nothing worth showing and
  // vanish — that reads as broken. It says so instead.
  test("an uneventful chat still opens, and says there is nothing", async ({ page }) => {
    await stubTimeline(page, []);
    await page.goto("/p/7/chat");
    await page.getByTestId("chat-timeline-toggle").click();
    await expect(page.getByTestId("chat-timeline-panel")).toContainText("Nothing recorded");
  });
});
