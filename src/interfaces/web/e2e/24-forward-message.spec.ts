import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { runtime } from "./fixtures";

// Handing one message to another conversation, and the thread you cannot reply
// into.
//
// Both halves are about the same thing: a message must land where the screen
// says it will. A reply typed into a Telegram thread used to appear in it and
// be gone on the next reload — it had gone out on `web`, into a different
// conversation, with nothing on screen to say so. And a quote pasted between
// chats arrived as words with no author, no date, and no way back.
//
// The assertions are against real DOM because both fixes are things you can
// only see: a notice above the field, a card above a bubble, and a dialog that
// refuses to offer a destination the message cannot reach.

const AGENT = "northwind-bot";
const OTHER = "acme-bot";
const CONV = "conversation-example";
const TODAY = new Date().toISOString().slice(0, 10);

const nowIso = (minutesAgo = 0) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** A conversation with one agent, ending on something worth passing on. */
const MESSAGES = [
  { role: "user", content: "¿Cómo quedó el pedido de Acme?", ts: nowIso(30) },
  {
    role: "assistant",
    content: "Sale el lunes por la mañana.",
    ts: nowIso(29),
    agent: AGENT,
    agent_name: "Northwind",
    model: "mock:test",
  },
];

/** The same agent's chat, but reached with a message already forwarded into it
 *  — what the OTHER side of a forward looks like when it is read back. */
const FORWARDED = [
  {
    role: "user",
    content:
      "[forwarded message — from Telegram, said by Northwind]\n> Sale el lunes por la mañana.\n[end of forwarded message]\n\n¿lo confirmamos?",
    ts: nowIso(5),
    forwarded: {
      from: { kind: "thread", channel: "telegram", thread_id: TODAY, title: "Telegram" },
      author: "agent",
      author_name: "Northwind",
      text: "Sale el lunes por la mañana.",
      ts: nowIso(29),
    },
  },
];

async function stubChat(page: Page, pid: number, messages = MESSAGES) {
  // Every agent of every project — what makes somebody in ANOTHER project
  // reachable from this dialog. Includes this project's own rows, as the real
  // endpoint does, so the de-duplication is exercised too.
  await page.route(
    (url) => url.pathname === "/api/agents/directory",
    (route) =>
      route.fulfill({
        json: [
          { project_id: String(pid), project_name: "apx-e2e", slug: AGENT, name: "Northwind" },
          { project_id: "9001", project_name: "Otro proyecto", slug: "magui", name: "Maguí" },
          { project_id: "9001", project_name: "Otro proyecto", slug: "rocky", name: "Rocky" },
          { project_id: "9002", project_name: "Tercero", slug: "candela", name: "Candela" },
          { project_id: "9002", project_name: "Tercero", slug: "andy", name: "Andy" },
        ],
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/agents`,
    (route) =>
      route.fulfill({
        json: [
          { slug: AGENT, name: "Northwind", role: "master", emoji: "🚀", model: "mock:test" },
          { slug: OTHER, name: "Acme", role: "worker", emoji: "📦", model: "mock:test" },
        ],
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/agents/${AGENT}/conversations`,
    (route) =>
      route.fulfill({
        // The daemon's own field names (`ConversationListEntry`): the session
        // list reads `ended_at`/`started_at` and falls back to the ID when they
        // are missing, which is how a fixture ends up dated in 2001.
        json: [{ id: CONV, filename: `${CONV}.md`, agent_slug: AGENT, title: "Acme", messages: messages.length, started_at: nowIso(60), ended_at: nowIso() }],
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/agents/${OTHER}/conversations`,
    (route) =>
      route.fulfill({
        json: [{ id: "acme-01", filename: "acme-01.md", agent_slug: OTHER, title: "Envíos", messages: 4, started_at: nowIso(600), ended_at: nowIso(120) }],
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/agents/${AGENT}/conversations/${CONV}`,
    (route) => route.fulfill({ json: { id: CONV, agent_slug: AGENT, channel: "web", messages } }),
  );
  // The super-agent's threads: one Telegram day (readable, not writable) and
  // today's web thread.
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/super-agent/threads`,
    (route) =>
      route.fulfill({
        json: [
          { channel: "telegram", id: TODAY, title: "Telegram", messages: 2, started_at: nowIso(60), last_ts: nowIso(29) },
          { channel: "web", id: TODAY, title: "Web", messages: 2, started_at: nowIso(50), last_ts: nowIso(10) },
        ],
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${pid}/super-agent/threads/telegram/${TODAY}`,
    (route) =>
      route.fulfill({
        json: {
          channel: "telegram",
          id: TODAY,
          title: "Telegram",
          messages: [
            { role: "user", content: "¿Cómo quedó el pedido de Acme?", ts: nowIso(30) },
            { role: "assistant", content: "Sale el lunes por la mañana.", ts: nowIso(29), agent: "super_agent", agent_name: "APX" },
          ],
        },
      }),
  );
}

test.describe("forwarding a message", () => {
  test("a Telegram thread says it cannot be replied into, before you press enter", async ({ page, errors }) => {
    const { projectId } = runtime();
    await stubChat(page, projectId);
    await page.goto(`/p/${projectId}/chat?channel=telegram&thread=${TODAY}`);

    await expect(page.getByText("Sale el lunes por la mañana.")).toBeVisible();
    // The whole fix, in one element: the composer says where the reply is
    // going, instead of the reader finding out after a reload.
    const notice = page.getByTestId("delivered-channel-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Telegram");
    await expect(notice).toContainText("new session");

    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("the forward dialog offers people and sessions, and refuses the ones a message cannot reach", async ({ page, errors }) => {
    const { projectId } = runtime();
    await stubChat(page, projectId);
    await page.goto(`/p/${projectId}/chat?agent=${AGENT}&conv=${CONV}`);

    const bubble = page.getByText("Sale el lunes por la mañana.");
    await expect(bubble).toBeVisible();
    // The action lives on the message, beside Copy, on both sides of the chat.
    await bubble.hover();
    await page.getByTestId("forward-message").last().click();

    // What is going, shown before it goes — the same card the other side gets.
    await expect(page.getByTestId("forwarded-quote")).toContainText("Sale el lunes por la mañana.");

    // Pick somebody. Their most recent session comes preselected, so continuing
    // a conversation you were already having is one click.
    await page.getByTestId(`forward-agent-${OTHER}`).click();
    await expect(page.getByTestId("forward-session-acme-01")).toBeVisible();
    await expect(page.getByTestId("forward-session-__new__")).toBeVisible();

    // And the destinations a forward cannot land in are not offered at all.
    await page.getByTestId("forward-agent-__super_agent__").click();
    await expect(page.getByTestId(`forward-session-telegram:${TODAY}`)).toHaveCount(0);
    await expect(page.getByTestId(`forward-session-web:${TODAY}`)).toBeVisible();

    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("people in other projects are reachable, and a bad search is not a dead end", async ({ page, errors }) => {
    const { projectId } = runtime();
    await stubChat(page, projectId);
    await page.goto(`/p/${projectId}/chat?agent=${AGENT}&conv=${CONV}`);

    const bubble = page.getByText("Sale el lunes por la mañana.");
    await expect(bubble).toBeVisible();
    await bubble.hover();
    await page.getByTestId("forward-message").last().click();

    // Somebody in another project, under that project's own heading.
    await expect(page.getByTestId("forward-agent-magui")).toBeVisible();
    await expect(page.getByText("Otro proyecto")).toBeVisible();

    // THE REGRESSION. A query that matches nobody used to empty the list AND
    // remove the search field with it, leaving no way to correct the typo and a
    // dialog that said "no agents" to somebody who had seven.
    const search = page.getByTestId("forward-search");
    await search.fill("zzzz");
    await expect(page.getByTestId("forward-no-matches")).toBeVisible();
    await expect(search, "the field that caused the miss must survive it").toBeVisible();

    // And the way back out is offered, not just implied.
    await page.getByTestId("forward-search-clear").click();
    await expect(page.getByTestId("forward-agent-magui")).toBeVisible();

    // The project's name is a perfectly good way to ask for its people.
    await search.fill("tercero");
    await expect(page.getByTestId("forward-agent-candela")).toBeVisible();
    await expect(page.getByTestId("forward-agent-magui")).toHaveCount(0);

    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("a message that arrived by forward says where it came from", async ({ page, errors }) => {
    const { projectId } = runtime();
    await stubChat(page, projectId, FORWARDED);
    await page.goto(`/p/${projectId}/chat?agent=${AGENT}&conv=${CONV}`);

    const quote = page.getByTestId("forwarded-quote");
    await expect(quote).toBeVisible();
    await expect(quote).toContainText("Forwarded from");
    await expect(quote).toContainText("Telegram");
    await expect(quote).toContainText("Sale el lunes por la mañana.");
    // What the sender wrote is the message; the quote is the thing it is about.
    await expect(page.getByText("¿lo confirmamos?")).toBeVisible();
    // And the marker the MODEL was handed never reaches the reader.
    await expect(page.getByText("[end of forwarded message]")).toHaveCount(0);

    expect(errors, "no uncaught page errors").toEqual([]);
  });
});
