import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { runtime } from "./fixtures";

// Reading a thread BACK — which is most of what a transcript is for.
//
// Two things were wrong with it and both are invisible in a chat opened five
// minutes ago, which is the one everybody tests with:
//
//  1. A conversation spanning months rendered as one uninterrupted column. Only
//     the last bubble carried a date, so every answer above it read as having
//     been written today.
//  2. On a phone the transcript starts "pelado" (no tool log), and nothing in
//     the turn said work had happened — so an answer that took twelve shell
//     commands looked like an answer that took none, with no hint that the
//     header switch had anything to show.
//
// Both are asserted against real DOM at a real phone width, because both are
// layout answers: "the count is in the JSX" was already true of the second one
// before the fix, guarded by a `showTools &&` that a phone never satisfies.

const PHONE = { width: 390, height: 844 };
const AGENT = "northwind-bot";
const CONV = "conversation-example";

/** A wall-clock instant N days back, in the browser's own timezone — the same
 *  clock the divider reads, so "Hoy"/"Ayer" mean the same thing on both sides. */
function daysAgo(n: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Three days of conversation, ending with a turn that ran two tools — one of
 *  which failed, since a failed step is the half worth surfacing. */
const MESSAGES = [
  { role: "user", content: "¿Podés revisar el deploy?", ts: daysAgo(40) },
  {
    role: "assistant", content: "Lo miro y te aviso.", ts: daysAgo(40, 11),
    agent: AGENT, agent_name: "Northwind", model: "mock:test",
    usage: { input_tokens: 1200, output_tokens: 340 },
  },
  { role: "user", content: "¿Alguna novedad?", ts: daysAgo(1, 9) },
  { role: "assistant", content: "Sigo con eso.", ts: daysAgo(1, 9), agent: AGENT, agent_name: "Northwind" },
  { role: "user", content: "Dale, cerralo hoy", ts: daysAgo(0, 8) },
  { role: "tool", content: "", ts: daysAgo(0, 8), tool: "run_shell", args: { command: "npm run build" }, result: "ok" },
  { role: "tool", content: "", ts: daysAgo(0, 8), tool: "read_file", args: { path: "/path/to/project/deploy.md" }, result: { error: "ENOENT" } },
  {
    role: "assistant", content: "Listo, quedó cerrado.", ts: daysAgo(0, 8),
    agent: AGENT, agent_name: "Northwind", model: "mock:test",
    usage: { input_tokens: 4200, output_tokens: 610 },
  },
];

/** Everything the chat pane asks for, answered from the fixture above. The
 *  daemon is real but this conversation is not — a spec that depended on a
 *  months-old thread existing on the machine running it would only pass here. */
async function stubChat(page: Page, pid: number) {
  await page.route(
    (url) => url.pathname === "/api/inbox",
    (route) => route.fulfill({
      json: [{
        project_id: pid, project_name: "apx-e2e", project_path: "/path/to/project",
        agent_slug: AGENT, agent_name: "Northwind", agent_emoji: "🚀", agent_icon: null,
        kind: "agent", pinned: false, conversation_id: CONV, channel: "web",
        messages: MESSAGES.length, preview: "Listo, quedó cerrado.", last_activity_at: daysAgo(0),
      }],
    }),
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/agents`,
    (route) => route.fulfill({
      json: [{ slug: AGENT, name: "Northwind", role: "master", emoji: "🚀", model: "mock:test" }],
    }),
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/agents/${AGENT}/conversations`,
    (route) => route.fulfill({
      json: [{ id: CONV, title: "Deploy", messages: MESSAGES.length, updated_at: daysAgo(0), created_at: daysAgo(40) }],
    }),
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/agents/${AGENT}/conversations/${CONV}`,
    (route) => route.fulfill({
      json: { id: CONV, agent_slug: AGENT, channel: "web", messages: MESSAGES },
    }),
  );
}

test.describe("chat transcript", () => {
  test("a thread spanning days is cut by day dividers", async ({ page, errors }) => {
    const { projectId } = runtime();
    await stubChat(page, projectId);
    await page.goto(`/p/${projectId}/chat?agent=${AGENT}&conv=${CONV}`);

    await expect(page.getByText("Listo, quedó cerrado.")).toBeVisible();

    const dividers = page.getByTestId("chat-day-divider");
    // Three days in the fixture, three dividers — the oldest one dated, then
    // "Ayer", then "Hoy". Never one per message, and never none.
    await expect(dividers).toHaveCount(3);
    await expect(dividers.nth(1)).toHaveText("Yesterday");
    await expect(dividers.nth(2)).toHaveText("Today");
    // 40 days back is neither, so it is spelled out. (A fresh browser profile
    // has picked no language, and the panel's own default is English.)
    await expect(dividers.nth(0)).not.toHaveText(/Today|Yesterday/);

    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("the phone shows what a turn cost and that it ran tools, pelado or not", async ({ page, errors }) => {
    const { projectId } = runtime();
    await page.setViewportSize(PHONE);
    await stubChat(page, projectId);
    // The phone surface, not the desktop one squeezed narrow: `compact` is what
    // both of these regressions lived behind.
    await page.goto(`/m/chat/${projectId}/${AGENT}/${CONV}`);

    await expect(page.getByText("Listo, quedó cerrado.")).toBeVisible();

    // Simple view is the default and hides the tool LOG. That the turn ran
    // tools at all is not part of the log — it is the reason to go looking for
    // one, and it has to survive on a 390px screen.
    await expect(page.getByTestId("turn-tools-count")).toBeVisible();
    // The turn's spend, on the same line, at phone width.
    await expect(page.getByText(/4\.8k tok/)).toBeVisible();

    // Flip the header switch and the log itself appears — a phone had no way to
    // identify this control while its icon was desktop-only. A finished turn's
    // block opens collapsed, naming what it holds; the steps are one tap in.
    await page.getByRole("switch").first().click();
    const block = page.getByTestId("action-group").last();
    await expect(block).toContainText("2 actions");
    await expect(block).toContainText("1 failed");
    await block.getByTestId("action-group-toggle").click();
    const calls = page.getByTestId("tool-call");
    await expect(calls.first()).toBeVisible();
    // The failed step is reported as failed, in words and not only in colour.
    await expect(page.locator('[data-testid="tool-call"][data-status="error"]')).toBeVisible();

    // And no tool row spills out of the phone: the whole point of the fix is
    // that the status mark survives a long argument.
    const box = await calls.first().boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);

    expect(errors, "no uncaught page errors").toEqual([]);
  });
});
