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

  test("a routine run is announced from start to finish, and lands in its history", async ({ page, errors }) => {
    // A run used to exist only inside the tab that started it: refresh, and a
    // routine still working looked idle. And the executions list counted the
    // "routine created" ledger row as a successful run, because it filtered on
    // meta.routine and an edit carries no status. Both are protocol-level here:
    // the frames the daemon pushes, and what the history route returns after.
    const rt = runtime();
    const name = `e2e-live-run-${Date.now()}`;
    const call = (path: string, init?: RequestInit) =>
      fetch(`${rt.daemon}${path}`, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${rt.token}`, ...(init?.headers || {}) },
      });

    // A shell routine: real pipeline, no engine, no key, milliseconds.
    const created = await call(`/api/projects/${rt.projectId}/routines`, {
      method: "POST",
      body: JSON.stringify({ name, kind: "shell", schedule: "manual", spec: { command: "echo hola" } }),
    });
    expect(created.status, "the routine was created").toBe(201);

    try {
      const frames = watchLiveFeed(page);
      await page.goto(`/p/${rt.projectId}/routines?r_id=${name}`);
      await expect.poll(() => frames.length, { timeout: 10_000 }).toBeGreaterThan(0);

      const fired = await call(`/api/projects/${rt.projectId}/routines/${name}/run`, { method: "POST" });
      expect(fired.status, "the routine ran").toBe(200);

      const runFrames = () =>
        frames.map((f) => JSON.parse(f)).filter((f) => f.type === "routine" && f.routine === name);
      await expect.poll(() => runFrames().map((f) => f.phase), { timeout: 10_000 })
        .toEqual(expect.arrayContaining(["start", "end"]));
      // The closing frame says how it went — that is what lets a panel drop the
      // live row and revalidate in one move.
      expect(runFrames().find((f) => f.phase === "end").run.status).toBe("ok");

      const runs = await (await call(`/api/projects/${rt.projectId}/routines/${name}/runs`)).json();
      expect(runs.length, `only the run counts, not the creation: ${JSON.stringify(runs.map((r: { body: string }) => r.body))}`).toBe(1);
      expect(runs[0].status).toBe("ok");
      expect(errors, "no uncaught page errors").toEqual([]);
    } finally {
      await call(`/api/projects/${rt.projectId}/routines/${name}`, { method: "DELETE" });
    }
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
