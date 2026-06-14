import { test, expect } from "./fixtures";

// The 404 trap (QA requirement): the daemon's SPA fallback serves index.html
// with HTTP 200 for ANY unknown non-API path (src/host/daemon/api/web.js). So a
// test that only checks the HTTP status would be a FALSE POSITIVE. These tests
// assert RENDERED CONTENT instead: an unknown client route must show the
// NotFound screen, NOT a real screen and NOT a blank shell.
test.describe("not-found / 404 trap", () => {
  test("unknown client route renders the NotFound screen, not a real screen", async ({ page, errors }) => {
    await page.goto("/this/route/definitely/does/not/exist");
    // Content-based assertion (status would be a misleading 200):
    await expect(page.getByTestId("screen-not-found")).toBeVisible();
    // And it must NOT silently render a real screen.
    await expect(page.getByTestId("screen-admin")).toHaveCount(0);
    expect(errors, "no uncaught errors on the not-found screen").toEqual([]);
  });

  test("the daemon returns HTTP 404 (not a misleading 200) for an unknown route", async ({ request }) => {
    // The daemon's SPA fallback now sets the status to match what the user sees:
    // a known client route → 200, an unknown one → 404 (still serving the shell
    // so React Router renders the styled NotFound). This closes the "200 for a
    // route that doesn't exist" trap. Hit the daemon directly (not the vite dev
    // server, whose own fallback always answers 200).
    const daemon = process.env.APX_DAEMON_URL || "http://localhost:7430";
    const res = await request.get(`${daemon}/this/route/definitely/does/not/exist`);
    expect(res.status()).toBe(404);
    expect((await res.text()).toLowerCase()).toContain("<!doctype html"); // still the shell
    // And a real client route stays 200.
    const ok = await request.get(`${daemon}/settings`);
    expect(ok.status()).toBe(200);
  });

  test("app shell still mounts on an unknown route (NotFound lives inside the shell)", async ({ page }) => {
    await page.goto("/zzz-nope");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("screen-not-found")).toBeVisible();
  });
});
