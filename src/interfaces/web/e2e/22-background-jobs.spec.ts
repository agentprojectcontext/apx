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

/** An ordinary project-agent conversation, LAST in the list on purpose: the
 *  fallback picks the newest row, so a deep link that only works when the row
 *  it asks for happens to be the first one is a deep link that does nothing. */
const agentRow = {
  ...a2aRow,
  agent_slug: "linus",
  agent_name: "Linus",
  agent_emoji: "🐧",
  kind: "agent",
  participants: undefined,
  participant_faces: undefined,
  conversation_id: "2026-09-14-01",
  channel: "web",
  preview: "Linus: listo.",
  last_activity_at: new Date(Date.now() - 3_600_000).toISOString(),
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
    route.fulfill({ json: [a2aRow, quietRow, agentRow] }));
  await page.route((url) => url.pathname === "/api/jobs", (route) =>
    route.fulfill({ json: { data: jobs, meta: { total: jobs.length, open: jobs.length } } }));
}

test.describe("background jobs", () => {
  // THE REVERSAL, 2026-09-14. This used to assert the opposite — that nothing
  // running draws no chip at all, because "the appearance IS the news". Manu
  // overruled it: "quizás estaría bueno que siempre arriba esté el numerador de
  // procesos traseros y que diga cero, en gris… como que tenga posibilidad de
  // estar viéndolo." A control that only exists while it matters cannot be
  // LOOKED AT — you can only be told, and only if you happen to be looking.
  test("at rest the counter is still there, reading zero and out of the way", async ({ page, errors }) => {
    await stub(page, []);
    await page.goto("/inbox");
    await expect(page.getByTestId("inbox-list")).toBeVisible();

    const global = page.getByTestId("background-jobs");
    await expect(global).toBeVisible();
    await expect(global).toHaveText("0");
    await expect(global).toHaveAttribute("data-state-running", "false");
    // Muted, not coloured: present to be read, not to be noticed.
    await expect(global).toHaveClass(/text-muted-fg/);
    // And NOT spinning — a different GLYPH, not the same one frozen. Keeping the
    // spinner and stopping it reads as a stuck load: a circle that is obviously
    // a progress indicator, not progressing. At rest it is stacked squares, the
    // thing itself, which happens to be empty.
    await expect(global.locator(".animate-spin")).toHaveCount(0);
    await expect(global.locator("svg.lucide-square-stack")).toHaveCount(1);

    // Openable at rest too, or "is anything running?" stays a question you can
    // only have been told the answer to.
    await global.click();
    await expect(page.getByTestId("jobs-empty")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("with work on it the same control colours and spins", async ({ page }) => {
    await stub(page, [job]);
    await page.goto("/inbox");
    const global = page.getByTestId("background-jobs");
    await expect(global).toHaveText("1");
    await expect(global).toHaveAttribute("data-state-running", "true");
    // The green the menu, the context strip and the chat-row mark already use,
    // so the chip and everything it stands for read as one subject.
    await expect(global).toHaveClass(/text-emerald-700/);
    await expect(global.locator(".animate-spin")).toHaveCount(1);
    await expect(global.locator("svg.lucide-square-stack")).toHaveCount(0);
  });

  test("every chat header carries the count, including the chats that can never own one", async ({ page }) => {
    // A job is filed under the a2a PAIR it opened, so a Telegram or web chat
    // reads a permanent nought — and that nought is this chat ANSWERING, which
    // is the whole reason the control stopped disappearing. What it must never
    // do is fall back to the global count and claim work happening between two
    // other agents.
    await stub(page, [job]);
    await page.goto("/inbox?channel=a2a&thread=april~super_agent");
    const chip = page.getByTestId("thread-jobs");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-state-running", "false");
    // A NUMBER, not a sentence. The header used to spell "no tasks" out, which
    // on a phone cost the width of the two controls beside it and still read
    // as a label rather than a status. The word lives in the tooltip now.
    await expect(chip).toHaveText("0");
    await expect(chip).toHaveAttribute("aria-label", /nada|nothing/i);
    // Meanwhile the global one still counts it — that is precisely its job.
    await expect(page.getByTestId("background-jobs")).toHaveText("1");
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
    // Its own count, which is the whole point of the scoped mount: this chat's
    // one job, said in the one character it takes to say it.
    await expect(chip).toHaveText("1");
    await expect(chip).toHaveAttribute("aria-label", /1/);
    // Same panel, one tap away — not a second, smaller rendering of the truth.
    await chip.click();
    await expect(page.getByTestId(`cancel-job-${job.id}`)).toBeVisible();
    expect(errors).toEqual([]);
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

  test("the marks share the tag line, and stand side by side", async ({ page }) => {
    // Two facts at once: work is still out AND the agent said something this
    // device has not read. They used to take turns in one 12px slot, so the
    // louder one erased the other. Manu: "el punto azul con la señal de proceso
    // segundo plano podrían ir doble (ambas a la vez)".
    await page.addInitScript(() =>
      // A seeded store with no mark for this row = something new here. Without
      // the baseline the first load counts everything as already seen.
      localStorage.setItem("apx.chat.read.v1", JSON.stringify({ seeded: true, marks: {} })),
    );
    await page.route((url) => url.pathname === "/api/projects", (route) =>
      route.fulfill({ json: [{ id: 7, name: "Northwind", path: "/p", kind: "company", agents: 2, apx_id: "nw1", storage_path: "/p" }] }));
    await page.route((url) => url.pathname === "/api/inbox", (route) =>
      route.fulfill({
        json: [
          // The newest row takes the selection — and a row you are LOOKING at
          // is read by definition, so the one under test has to be the other.
          quietRow,
          { ...a2aRow, preview_at: new Date(Date.now() - 60_000).toISOString(), last_activity_at: new Date(Date.now() - 60_000).toISOString() },
        ],
      }));
    await page.route((url) => url.pathname === "/api/jobs", (route) =>
      route.fulfill({ json: { data: [job], meta: { total: 1, open: 1 } } }));
    await page.goto("/inbox");

    const row = page.getByTestId(`inbox-row-a2a:${THREAD}`);
    // Both, named in one label — not one of them winning the slot.
    await expect(row.getByRole("status")).toHaveAttribute("aria-label", /(tarea|task).*(nueva|new)/i);
    // And both actually drawn: a mark that is off collapses to zero width.
    const drawn = await row.getByRole("status").evaluate((el) =>
      Array.from(el.children).filter((c) => c.getBoundingClientRect().width > 0).length);
    expect(drawn).toBe(2);
    // On the project/channel line — the one with room — so the message line
    // keeps the whole width for the message.
    await expect(row.getByTestId("inbox-row-meta").getByRole("status")).toBeVisible();
    const preview = await row.getByTestId("inbox-row-preview").boundingBox();
    const marks = await row.getByRole("status").boundingBox();
    expect(marks!.y + marks!.height).toBeLessThanOrEqual(preview!.y + 1);
  });

  test("a deep link reaches an agent's conversation, not just a channel thread", async ({ page }) => {
    // ChatTab addresses a session two ways — `?channel=&thread=` and
    // `?agent=&conv=` — and this screen only ever read the first, so
    // `/inbox?agent=X&conv=Y` silently opened the NEWEST chat instead. Manu
    // refreshed on a conversation with a message parked in it, landed somewhere
    // else, and reasonably read that as the message being gone. It was not: he
    // was reading a different chat.
    await stub(page, []);
    await page.goto(`/inbox?agent=${agentRow.agent_slug}&conv=${agentRow.conversation_id}`);
    // The row it ASKED for, which is deliberately not the one the fallback
    // would land on — otherwise the assertion passes on a deep link that is
    // being ignored.
    await expect(page.getByTestId(`inbox-row-${agentRow.agent_slug}`)).toHaveClass(/bg-primary\/12/);
    await expect(page.getByTestId(`inbox-row-a2a:${THREAD}`)).not.toHaveClass(/bg-primary\/12/);
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
