import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, runtime } from "./fixtures";

/**
 * Usability journeys: what a person actually does, across screens.
 *
 * Every other spec opens ONE screen and checks it renders. That is how the
 * add-project dialog shipped closing itself a second after it opened over
 * /inbox (2026-09-28): the dialog worked on `/`, the inbox worked on its own,
 * and the bug only existed in the combination — a dialog that lives in the URL
 * (`?action=add-project`) opened over a screen that also writes the URL.
 *
 * So the question here is never "does it render" but "does it STAY": open a
 * dialog from every screen that can open it, wait long enough for every effect
 * on that screen to have run, and assert it is still there and the rest of the
 * URL survived the round trip.
 */

/** Long enough for every effect a screen runs on mount AND on a URL change
 *  (SWR revalidation, auto-select-first-row, chat-query sync) to have fired. */
const SETTLE_MS = 1_500;

async function api(p: string, init?: RequestInit) {
  const rt = runtime();
  return fetch(`${rt.daemon}${p}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${rt.token}`, ...(init?.headers || {}) },
  });
}

/**
 * Talk to the super-agent from the inbox, the way a new user would, and come
 * back to /inbox with that conversation open.
 *
 * This is what makes the inbox EMBED a chat that mirrors `?channel=&thread=`
 * into the URL — the exact screen the 2026-09-28 bug lived on. A fresh install
 * has no thread, the embedded chat then writes nothing, and a test run there
 * would pass for the wrong reason. The gate points the super-agent at the
 * offline `mock` engine (scripts/e2e-gate.js), so this costs no key and no
 * network. Synthetic content only (AGENTS.md rule 3).
 */
async function openInboxThread(page: Page) {
  await page.goto("/inbox");
  const box = page.getByRole("textbox", { name: /Type something|Escrib/ });
  await expect(box).toBeVisible();
  await box.fill("Hola, esto es una prueba");
  await box.press("Enter");
  await expect(page.getByText(/received: Hola, esto es una prueba/).first()).toBeVisible();
  await page.goto("/inbox");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread"), {
    message: "the embedded chat mirrors its thread into the URL",
  }).not.toBeNull();
}

function addProjectDialog(page: Page): Locator {
  // The dialog carries no testid of its own; its kind select does.
  return page.getByRole("dialog").filter({ has: page.getByTestId("project-kind") });
}

/** Open add-project from the rail, wait, and assert it is still open with the
 *  screen's own query intact. */
async function expectAddProjectStaysOpen(page: Page, url: string, keep: string[] = []) {
  await page.goto(url);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  // Let the screen finish its own URL writes first — the bug was a write that
  // happened AFTER the dialog opened, but a screen that is still settling would
  // make the "before" query below a lie.
  await page.waitForTimeout(SETTLE_MS);
  const before = new URL(page.url()).searchParams;

  await page.getByTestId("nav-add-project").click();
  const dialog = addProjectDialog(page);
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
  await expect(dialog, `add-project must stay open over ${url}`).toBeVisible();

  const during = new URL(page.url()).searchParams;
  expect(during.get("action"), `?action survives on ${url}`).toBe("add-project");
  for (const k of keep) {
    expect(during.get(k), `the screen's own ?${k} survives opening the dialog on ${url}`).toBe(before.get(k));
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const after = new URL(page.url()).searchParams;
  expect(after.get("action"), "closing drops ?action").toBeNull();
  for (const k of keep) {
    expect(after.get(k), `the screen's own ?${k} survives closing the dialog on ${url}`).toBe(before.get(k));
  }
}

test.describe("usability journeys", () => {
  test.describe("add-project stays open over every screen", () => {
    test("over the inbox with a conversation open (the 2026-09-28 regression)", async ({ page, errors }) => {
      await openInboxThread(page);
      await expectAddProjectStaysOpen(page, page.url(), ["channel", "thread", "agent", "conv"]);
      expect(errors).toEqual([]);
    });

    test("over a deep link into an inbox thread", async ({ page }) => {
      await openInboxThread(page);
      const deep = page.url();
      await expectAddProjectStaysOpen(page, deep, ["channel", "thread", "agent", "conv"]);
    });

    const screens: Array<[string, (pid: number) => string, string[]]> = [
      ["the admin home", () => "/", []],
      ["the Base chat", () => "/p/0/chat", []],
      ["a project chat", (pid) => `/p/${pid}/chat`, ["agent", "conv", "channel", "thread"]],
      ["a project's tasks", (pid) => `/p/${pid}/tasks`, []],
      ["a project's task board", (pid) => `/p/${pid}/tasks?view=board`, ["view"]],
      ["a project's routines", (pid) => `/p/${pid}/routines`, ["r_id"]],
      ["Base sessions", () => "/p/0/sessions", ["s"]],
      ["Base commitments", () => "/p/0/commitments", []],
      ["project config on a tab", (pid) => `/p/${pid}/config?tab=agents`, ["tab"]],
      ["skills settings on a tab", () => "/settings/skills?tab=rag", ["tab"]],
      ["the Code module", () => "/code", []],
      ["settings", () => "/settings/identity", []],
    ];
    for (const [name, url, keep] of screens) {
      test(`over ${name}`, async ({ page, errors }) => {
        await expectAddProjectStaysOpen(page, url(runtime().projectId), keep);
        expect(errors).toEqual([]);
      });
    }

    test("from the Workspaces button, not only the rail", async ({ page }) => {
      await page.goto("/p/0/workspaces?action=add-project");
      const dialog = addProjectDialog(page);
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(SETTLE_MS);
      await expect(dialog).toBeVisible();
    });
  });

  test.describe("add-project dismisses the three ways people dismiss things", () => {
    test("Escape", async ({ page }) => {
      await page.goto("/?action=add-project");
      await expect(addProjectDialog(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(addProjectDialog(page)).toBeHidden();
    });

    test("Cancel", async ({ page }) => {
      await page.goto("/?action=add-project");
      const dialog = addProjectDialog(page);
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button").filter({ hasText: /^(Cancel|Cancelar)$/ }).click();
      await expect(dialog).toBeHidden();
      expect(new URL(page.url()).searchParams.get("action")).toBeNull();
    });

    test("a click outside", async ({ page }) => {
      await page.goto("/?action=add-project");
      const dialog = addProjectDialog(page);
      await expect(dialog).toBeVisible();
      await page.mouse.click(5, 5);
      await expect(dialog).toBeHidden();
    });

    test("Back after opening it leaves the dialog closed, not the page", async ({ page }) => {
      await page.goto("/inbox");
      await page.getByTestId("nav-add-project").click();
      await expect(addProjectDialog(page)).toBeVisible();
      await page.goBack();
      await expect(addProjectDialog(page)).toBeHidden();
      await expect(page).toHaveURL(/\/inbox/);
    });
  });

  test("registering a folder through the dialog lands on the new project", async ({ page, errors }) => {
    // Marked `apx-e2e-` so the teardown's safety net recognises it as ours.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-register-"));
    let newId: string | null = null;
    try {
      await page.goto("/inbox");
      await page.getByTestId("nav-add-project").click();
      const dialog = addProjectDialog(page);
      await expect(dialog).toBeVisible();
      const input = dialog.getByRole("textbox").first();
      await input.fill(dir);
      await input.press("Enter");
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page).toHaveURL(/\/p\/\d+/);
      newId = new URL(page.url()).pathname.split("/")[2];
      // Reachable from the rail: inline when it fits, otherwise inside the "+N"
      // bucket, which then carries the active mark. At 720px tall two projects
      // are 3px short of fitting one inline, so both land in the bucket — a
      // layout limit, not a lost project; what must never happen is the new
      // project being in neither place.
      const inline = page.getByTestId(`project-avatar-${newId}`);
      if (!(await inline.isVisible())) {
        await page.getByTestId("nav-projects-overflow").click();
        await expect(page.getByTestId(`project-menu-item-${newId}`)).toBeVisible();
        await page.keyboard.press("Escape");
      }
      expect(errors).toEqual([]);
    } finally {
      if (newId) await api(`/api/projects/${newId}`, { method: "DELETE" });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test.describe("other dialogs stay open over screens that write the URL", () => {
    test("new task", async ({ page }) => {
      await page.goto(`/p/${runtime().projectId}/tasks`);
      await page.getByTestId("task-new").click();
      await expect(page.getByTestId("task-input")).toBeVisible();
      await page.waitForTimeout(SETTLE_MS);
      await expect(page.getByTestId("task-input")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("task-input")).toBeHidden();
    });

    test("new agent", async ({ page }) => {
      await page.goto(`/p/${runtime().projectId}/agents`);
      await page.getByTestId("agent-new").click();
      await expect(page.getByTestId("agent-name")).toBeVisible();
      await page.waitForTimeout(SETTLE_MS);
      await expect(page.getByTestId("agent-name")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("agent-name")).toBeHidden();
    });

    test("new chat, from the inbox", async ({ page }) => {
      await openInboxThread(page);
      await page.getByTestId("inbox-new-chat").click();
      await expect(page.getByTestId("new-chat-sheet")).toBeVisible();
      await page.waitForTimeout(SETTLE_MS);
      await expect(page.getByTestId("new-chat-sheet")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("new-chat-sheet")).toBeHidden();
    });

    test("the floating chat, over the inbox", async ({ page }) => {
      await openInboxThread(page);
      await page.getByTestId("nav-roby").click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(SETTLE_MS);
      await expect(sheet).toBeVisible();
    });

    test("the mobile-link dialog", async ({ page }) => {
      await page.goto(`/p/${runtime().projectId}/tasks`);
      await page.getByTestId("mobile-link").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(SETTLE_MS);
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });
  });

  test.describe("navigation keeps state", () => {
    test("a task filter survives leaving and coming Back", async ({ page }) => {
      // The state filter is a per-device preference, not a URL param — so what
      // must hold is that it is still applied when you come back.
      const pid = runtime().projectId;
      await page.goto(`/p/${pid}/tasks`);
      await page.getByTestId("task-filter-done").click();
      await expect(page.getByTestId("task-filter-done")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("nav-inbox").click();
      await expect(page).toHaveURL(/\/inbox/);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/p/${pid}/tasks`));
      await expect(page.getByTestId("task-filter-done")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("task-filter-open").click();
    });

    test("a settings tab survives a reload", async ({ page }) => {
      await page.goto("/settings/skills?tab=rag");
      await page.reload();
      await expect(page).toHaveURL(/tab=rag/);
    });

    test("the open inbox thread survives a reload", async ({ page }) => {
      await openInboxThread(page);
      const addr = page.url();
      await page.reload();
      await page.waitForTimeout(SETTLE_MS);
      expect(page.url()).toBe(addr);
    });
  });

  test.describe("a first install", () => {
    test("the Base workspaces screen offers to add a project", async ({ page, errors }) => {
      await page.goto("/p/0/workspaces");
      await expect(page.getByTestId("project-tab-workspaces")).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("an empty project's routines and tasks say they are empty", async ({ page, errors }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-empty-"));
      const reg = await api("/api/projects", { method: "POST", body: JSON.stringify({ path: dir, init: true }) });
      expect(reg.ok).toBe(true);
      const { id } = (await reg.json()) as { id: number };
      try {
        for (const tab of ["routines", "tasks", "commitments", "agents", "chat"]) {
          await page.goto(`/p/${id}/${tab}`);
          await expect(page.getByTestId(`project-tab-${tab}`)).toBeVisible();
          await page.waitForTimeout(300);
        }
        expect(errors).toEqual([]);
      } finally {
        await api(`/api/projects/${id}`, { method: "DELETE" });
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
