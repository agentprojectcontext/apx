import { test, expect } from "./fixtures";

// Switching chats has to switch the CHAT.
//
// A conversation is addressed by (agent, id) — `load(agentSlug, convId)` — but
// the reload effect was keyed on the id alone. Two agents in one project can
// each own a conversation called `web-main`, and in a real project they do: the
// URL, the sidebar row and the agent's name in the header all changed on the
// click, the key did not, so the effect never re-ran. The previous agent's
// transcript stayed on screen under the new agent's name and the new agent's
// date — the most expensive kind of wrong, because everything around it says it
// is right.

const PID = "1";
const CONV = "web-main"; // the SAME id under both agents — that is the bug

const AGENTS = [
  { slug: "rocky", name: "Rocky", emoji: "🛠️", icon: null },
  { slug: "ceo", name: "Zoya", emoji: "🧭", icon: null },
];

const SAID = {
  rocky: "Rocky habla del triage de Knot.",
  ceo: "Zoya habla del brief de CarWash.",
};

const conversation = (slug: "rocky" | "ceo") => ({
  id: CONV,
  title: AGENTS.find((a) => a.slug === slug)!.name,
  channel: "web",
  started_at: "2026-09-04T10:00:00Z",
  messages: [
    { role: "user", content: "¿Cómo venís?", ts: "2026-09-04T10:00:00Z" },
    { role: "assistant", content: SAID[slug], ts: "2026-09-04T10:01:00Z" },
  ],
});

async function routeProject(page: import("@playwright/test").Page) {
  await page.route(
    (url) => url.pathname === `/api/projects/${PID}/agents`,
    (route) => route.fulfill({ json: AGENTS }),
  );
  // Both agents own a conversation with the same id.
  for (const slug of ["rocky", "ceo"] as const) {
    await page.route(
      (url) => url.pathname === `/api/projects/${PID}/agents/${slug}/conversations`,
      (route) => route.fulfill({ json: [{ id: CONV, title: AGENTS.find((a) => a.slug === slug)!.name, channel: "web", started_at: "2026-09-04T10:00:00Z", messages: 2 }] }),
    );
    await page.route(
      (url) => url.pathname === `/api/projects/${PID}/agents/${slug}/conversations/${CONV}`,
      (route) => route.fulfill({ json: conversation(slug) }),
    );
  }
  // No channel threads to fold into the sidebar — this is about agent chats.
  await page.route(
    (url) => url.pathname.endsWith("/super-agent/threads"),
    (route) => route.fulfill({ json: [] }),
  );
}

test.describe("switching chats", () => {
  test("two agents sharing a conversation id do not share a transcript", async ({ page, errors }) => {
    await routeProject(page);
    await page.goto(`/p/${PID}/chat?agent=rocky&conv=${CONV}`);
    await expect(page.getByText(SAID.rocky)).toBeVisible();

    // Same conversation id, other agent. Everything about the frame changes;
    // what has to change with it is the transcript.
    await page.goto(`/p/${PID}/chat?agent=ceo&conv=${CONV}`);
    await expect(page.getByText(SAID.ceo)).toBeVisible();
    await expect(page.getByText(SAID.rocky)).toHaveCount(0);

    // And back, so this cannot pass by loading the second one once and sticking.
    await page.goto(`/p/${PID}/chat?agent=rocky&conv=${CONV}`);
    await expect(page.getByText(SAID.rocky)).toBeVisible();
    await expect(page.getByText(SAID.ceo)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("clicking the other agent in the sidebar swaps the transcript too", async ({ page, errors }) => {
    // The URL route above proves the load; this proves the click that produces
    // it, which is how anybody actually hits this — ChatTab is keyed on `pid`
    // alone, so an in-project switch never remounts and only the effect saves it.
    await routeProject(page);
    await page.goto(`/p/${PID}/chat?agent=rocky&conv=${CONV}`);
    await expect(page.getByText(SAID.rocky)).toBeVisible();

    await page.getByTestId("chat-row-ceo-web-main").click();
    await expect(page.getByText(SAID.ceo)).toBeVisible();
    await expect(page.getByText(SAID.rocky)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
