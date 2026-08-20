import { test, expect, runtime } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * The live feed: what one device does, every other device sees.
 *
 * APX is one agent reachable from several places at once, so a panel that only
 * shows what IT did is showing a fraction of the conversation. These specs pin
 * the wiring end to end at the protocol level: the page opens an authenticated
 * socket, the daemon writes a row, and every open page is told which thread
 * moved. What each screen does with that (revalidate the list, re-read the open
 * thread) is asserted by the unit tests for those hooks.
 */

/** Collect every frame the page receives on the live feed. */
function watchLiveFeed(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/api/events/ws")) return;
    ws.on("framereceived", (f) => frames.push(String(f.payload)));
  });
  return frames;
}

/** Write a message into a project's ledger — the same funnel every channel
 *  writes through, reachable without an engine or a bot token. */
async function injectMessage(body: string) {
  const rt = runtime();
  const res = await fetch(`${rt.daemon}/api/projects/${rt.projectId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${rt.token}` },
    body: JSON.stringify({ channel: "telegram", direction: "in", type: "user", author: "user", body }),
  });
  expect(res.status, "the daemon accepted the injected message").toBe(201);
}

test.describe("live updates", () => {
  test("the inbox opens an authenticated feed and is told when a ledger moves", async ({ page, errors }) => {
    const frames = watchLiveFeed(page);
    await page.goto("/m/inbox");
    await expect(page.getByTestId("inbox-list")).toBeVisible();

    // The socket connected at all — an unauthorized upgrade is refused with a
    // 401 and no frame ever arrives.
    await expect.poll(() => frames.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(JSON.parse(frames[0]).type, "the feed greets a new client").toBe("hello");

    await injectMessage("live feed check");

    await expect
      .poll(() => frames.map((f) => JSON.parse(f)).filter((f) => f.type === "messages").length, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    const moved = frames.map((f) => JSON.parse(f)).find((f) => f.type === "messages");
    expect(moved.events.some((e: { channel: string }) => e.channel === "telegram")).toBe(true);
    // A frame says WHICH thread moved, never what was said.
    expect(JSON.stringify(moved)).not.toContain("live feed check");
    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("two devices on the same screen are both told", async ({ browser }) => {
    const rt = runtime();
    const seed = async (page: Page) => {
      await page.addInitScript((tok) => {
        try { localStorage.setItem("apx.token", tok as string); } catch { /* ignore */ }
      }, rt.token);
    };
    const [one, two] = await Promise.all([browser.newContext(), browser.newContext()]);
    const [pageOne, pageTwo] = await Promise.all([one.newPage(), two.newPage()]);
    await Promise.all([seed(pageOne), seed(pageTwo)]);

    const framesOne = watchLiveFeed(pageOne);
    const framesTwo = watchLiveFeed(pageTwo);
    await Promise.all([pageOne.goto("/m/inbox"), pageTwo.goto("/m/inbox")]);
    await expect(pageOne.getByTestId("inbox-list")).toBeVisible();
    await expect(pageTwo.getByTestId("inbox-list")).toBeVisible();
    await expect.poll(() => framesOne.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => framesTwo.length, { timeout: 10_000 }).toBeGreaterThan(0);

    await injectMessage("both devices");

    const moved = (frames: string[]) =>
      frames.map((f) => JSON.parse(f)).filter((f) => f.type === "messages").length;
    await expect.poll(() => moved(framesOne), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => moved(framesTwo), { timeout: 10_000 }).toBeGreaterThan(0);

    await Promise.all([one.close(), two.close()]);
  });
});
