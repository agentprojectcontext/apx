import { test, expect } from "./fixtures";

// A project whose folder was renamed or moved must SAY so, and must be
// repairable from the panel without losing its id.
//
// The regression this covers: `/proyectos_varios/knot` was renamed to
// `.../cheto`. A project is registered by path and nothing else, so every
// derived fact fell back instead of failing — the rail kept drawing "knot" with
// 0 agents and the old path in the breadcrumb, and nothing anywhere errored.
// The only reading available to the user was that the rename had reverted.
//
// GET /api/projects and the relink endpoint are both mocked, so the spec never
// touches the user's real registry and does not depend on the daemon's own
// relink being present.
const BASE = { id: 0, path: "/tmp/base", name: "Base", kind: "default" };
const OK = { id: 76, path: "/tmp/proj-ok", name: "Sano", kind: "software", agents: 3, missing: false };
const OLD_PATH = "/tmp/proyectos/knot";
const NEW_PATH = "/tmp/proyectos/cheto";
// What the daemon sends for a folder that is not there any more: the name has
// already degraded to the basename of the dead path, and the agent count to 0.
const GONE = {
  id: 77,
  path: OLD_PATH,
  name: "knot",
  kind: "software",
  agents: 0,
  missing: true,
  missing_reason: "the folder no longer exists",
};
const REPAIRED = { ...GONE, path: NEW_PATH, name: "Cheto", agents: 8, missing: false, missing_reason: null };

const CONFIG_BODY = {
  effective: {},
  project_only: {},
  project_config_path: "/tmp/config.json",
  apc_project: { name: "Cheto" },
  project_json_path: `${NEW_PATH}/.apc/project.json`,
};

test.describe("a project whose folder moved", () => {
  // Every relink the panel sends, so the spec can assert WHAT was asked for —
  // a body with no path means "find it yourself".
  let relinks: { id: string; body: Record<string, unknown> }[] = [];

  test.beforeEach(async ({ page }) => {
    let registry = [BASE, OK, GONE];
    relinks = [];

    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(registry),
      });
    });

    await page.route("**/api/projects/*/relink", async (route) => {
      const id = route.request().url().split("/").slice(-2)[0];
      const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
      relinks.push({ id, body });
      // Both repairs land in the same place; with no path the daemon is the one
      // that resolves it, by matching the apx_id among the old path's siblings.
      const to = (body.path as string) || NEW_PATH;
      registry = registry.map((p) => (String(p.id) === id ? { ...REPAIRED, path: to } : p));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, id: Number(id), from: OLD_PATH, path: to, agents: 8, persisted: true }),
      });
    });

    await page.route("**/api/projects/*/config", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONFIG_BODY) });
    });

    // Tall enough that both projects sit inline on the rail instead of
    // collapsing into the "+N" bucket.
    await page.setViewportSize({ width: 1200, height: 1000 });
  });

  test("the rail marks it with a ! and the healthy project without one", async ({ page, errors }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-avatar-77")).toBeVisible();

    await expect(page.getByTestId("project-avatar-77-warn")).toBeVisible();
    await expect(page.getByTestId("project-avatar-77-warn")).toHaveText("!");
    // The marker has to MEAN something: a healthy project must not wear one, or
    // it stops being a signal.
    await expect(page.getByTestId("project-avatar-76-warn")).toHaveCount(0);

    // The right-click menu carries the reason, next to the way into config.
    await page.getByTestId("project-avatar-77").click({ button: "right" });
    await expect(page.getByTestId("project-ctx-missing-77")).toContainText("no longer exists");
    expect(errors).toEqual([]);
  });

  test("config explains what happened and offers to find the folder", async ({ page, errors }) => {
    await page.goto("/p/77/config");

    const banner = page.getByTestId("project-folder-missing");
    await expect(banner).toBeVisible();
    // Which absence it is, not a flattened "something went wrong": a folder
    // that is gone and a folder without .apc/project.json need different fixes.
    // Case-insensitive because the panel localises the daemon's sentence and
    // opens it as a sentence — the claim here is the reason, not its casing.
    await expect(banner).toContainText(/the folder no longer exists/i);
    // And the path it is still registered at — that is the thing that broke.
    await expect(banner).toContainText(OLD_PATH);

    await page.getByTestId("project-folder-find").click();

    // One click, no path: the daemon is asked to match the apx_id itself.
    await expect.poll(() => relinks.length).toBe(1);
    expect(relinks[0].id).toBe("77");
    expect(relinks[0].body).toEqual({});

    // And the screen tells the truth afterwards: the warning is gone from both
    // the card and the rail, without a reload.
    await expect(page.getByTestId("project-folder-missing")).toHaveCount(0);
    await expect(page.getByTestId("project-avatar-77-warn")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the folder can be typed in and changed by hand", async ({ page, errors }) => {
    await page.goto("/p/77/config");
    const field = page.getByTestId("project-folder-path");
    await expect(field).toHaveValue(OLD_PATH);

    // Saving the path it already has is not a request worth sending.
    await expect(page.getByTestId("project-folder-save")).toBeDisabled();

    await field.fill("/tmp/proyectos/otra-carpeta");
    await page.getByTestId("project-folder-save").click();

    await expect.poll(() => relinks.length).toBe(1);
    expect(relinks[0].body).toEqual({ path: "/tmp/proyectos/otra-carpeta" });
    expect(errors).toEqual([]);
  });

  test("the repair still renders when the broken project's config cannot be read", async ({ page, errors }) => {
    // The realistic case: the folder is gone, so whatever reads it fails too.
    // An early return on that would blank the screen exactly when something is
    // broken — leaving no way to fix it from the panel at all.
    await page.route("**/api/projects/*/config", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "ENOENT" }) }),
    );

    await page.goto("/p/77/config");
    await expect(page.getByTestId("project-folder-missing")).toBeVisible();
    await expect(page.getByTestId("project-folder-find")).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test("a project hidden in the overflow bucket still shows its !", async ({ page, errors }) => {
    // The rail only draws as many tiles as fit; the rest collapse into "+N".
    // A warning that only exists on an inline tile is invisible for precisely
    // the projects nobody can see — which is most of them on a full rail.
    //
    // Overflow is forced with MORE PROJECTS rather than a shorter viewport: at
    // 400px tall the rail's own buttons overlap and the click never lands, which
    // is a fact about a cramped rail and not about this warning.
    const filler = Array.from({ length: 18 }, (_, i) => ({
      id: 78 + i, path: `/tmp/filler-${i}`, name: `Filler ${i}`, kind: "software", agents: 1, missing: false,
    }));
    // Higher ids sort first, so 76 and 77 are the two pushed into the bucket.
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([BASE, OK, GONE, ...filler]),
      });
    });
    await page.goto("/");

    const bucket = page.getByTestId("nav-projects-overflow");
    await expect(bucket).toBeVisible();
    await expect(page.getByTestId("nav-projects-overflow-warn")).toBeVisible();

    await bucket.click();
    await expect(page.getByTestId("project-menu-warn-77")).toBeVisible();
    await expect(page.getByTestId("project-menu-warn-76")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
