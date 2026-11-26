import type { Page } from "@playwright/test";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test.use({ hasTouch: true });

type Env = Awaited<ReturnType<typeof startCore>>;

/** A task with its chat; `at` orders the chats (later = newer). */
async function task(env: Env, title: string, at: number, change: Record<string, unknown> = {}, close?: string) {
  const made = await env.client.call("tasks.create", { title, status: "todo" });
  const chat = env.core.store.threads.create({ kind: "loose", title, agent_ids: ["superagent"], task_id: made.id });
  env.core.store.threads.settle(chat.id, `2099-01-01T00:${String(at).padStart(2, "0")}:00.000Z`, title);
  if (Object.keys(change).length) await env.client.call("tasks.update", { task: made.id, ...change });
  if (close) await env.client.call("tasks.close", { task: made.id, state: close as "done" | "dropped" });
}

/** One task in each section. */
async function everySection(env: Env) {
  await env.client.call("setup.finish", {});
  await task(env, "Section doing", 1, { status: "doing" });
  await task(env, "Section waiting", 2, { status: "doing", awaits_owner: true });
  await task(env, "Section pending", 3);
  await task(env, "Section done", 4, {}, "done");
  await task(env, "Section dropped", 5, {}, "dropped");
}

async function openTasks(page: Page, env: Env, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${env.core.url}/?lang=es`);
  if (width < 600) await page.getByRole("button", { name: "Volver a los chats", exact: true }).click();
  const inbox = page.getByRole("region", { name: "Inbox", exact: true });
  await inbox.getByRole("radio", { name: /^Tareas/ }).click();
  return inbox;
}

const headings = (page: Page) =>
  page.locator("section.inboxsec").evaluateAll((sections) => sections.map((s) => s.getAttribute("aria-label")));
const DEFAULT = ["En curso", "Te esperan", "Pendientes", "Listo", "Descartadas"];

const heading = async (page: Page, label: string) => {
  const box = await page.locator(".inboxsec__heading", { hasText: label }).boundingBox();
  if (!box) throw new Error(`${label} is not on screen`);
  return { x: box.x + box.width / 3, y: box.y + box.height / 2 };
};

/** Touch through the browser's own input, as a finger: down, held until the section lifts, moved in steps, up. */
async function touchDrag(page: Page, from: { x: number; y: number }, toY: number, shot: string) {
  const cdp = await page.context().newCDPSession(page);
  const point = (y: number) => [{ x: from.x, y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.y) });
  await expect(page.locator(".inboxsec.is-held")).toHaveCount(1);
  for (let i = 1; i <= 12; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(from.y + ((toY - from.y) * i) / 12),
    });
  await page.screenshot({ path: shot, fullPage: true });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("each task section shows ten tasks and more on request, Done before Dropped", async ({ page }, info) => {
  const env = await startCore({ port: 0, llm: scriptedLlm(() => say("Ready.")) });
  try {
    await env.client.call("setup.finish", {});
    for (let i = 1; i <= 23; i++) await task(env, `Paged task ${String(i).padStart(2, "0")}`, i);
    await task(env, "Paged finished", 30, {}, "done");
    await task(env, "Paged dropped", 31, {}, "dropped");
    const inbox = await openTasks(page, env, 1280);
    await expect(inbox.locator(".inboxsec__heading")).toHaveText(["Pendientes23", "Listo1", "Descartadas1"]);
    const pending = inbox.getByRole("region", { name: "Pendientes", exact: true });
    await expect(pending.locator(".taskbundle")).toHaveCount(10);
    await expect(pending.locator(".taskbundle").first()).toContainText("Paged task 23");
    await pending.getByRole("button", { name: "Ver 10 más", exact: true }).click();
    await expect(pending.locator(".taskbundle")).toHaveCount(20);
    await pending.getByRole("button", { name: "Ver 3 más", exact: true }).click();
    await expect(pending.locator(".taskbundle")).toHaveCount(23);
    await expect(pending.locator(".inboxsec__more")).toHaveCount(0);
    await expect(pending.locator(".taskbundle").last()).toContainText("Paged task 01");
    await page.screenshot({ path: info.outputPath("show-more-1280.png"), fullPage: true });
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("the Tasks tab sketches its rows while the tasks load, never an empty list", async ({ page }, info) => {
  const env = await startCore({ port: 0, llm: scriptedLlm(() => say("Ready.")) });
  try {
    await everySection(env);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/rpc/tasks.list", async (route) => {
      await held;
      await route.continue();
    });
    const inbox = await openTasks(page, env, 390);
    const sketch = inbox.getByRole("status", { name: "Cargando tareas", exact: true });
    await expect(sketch).toBeVisible();
    await expect(inbox.locator(".apx-empty")).toHaveCount(0);
    await expect(inbox.locator(".taskbundle")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("loading-390.png"), fullPage: true });
    release();
    await expect(inbox.locator(".taskbundle")).toHaveCount(5);
    await expect(sketch).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("a section held by its title moves whole to another place, kept on reload, and by keyboard", async ({
  page,
}, info) => {
  const env = await startCore({ port: 0, llm: scriptedLlm(() => say("Ready.")) });
  try {
    await everySection(env);
    const inbox = await openTasks(page, env, 1280);
    await expect.poll(() => headings(page)).toEqual(DEFAULT);
    // A click on a title still folds its section.
    const pending = inbox.getByRole("button", { name: "Pendientes 1", exact: true });
    await pending.click();
    await expect(pending).toHaveAttribute("aria-expanded", "false");
    await pending.click();
    await expect(pending).toHaveAttribute("aria-expanded", "true");
    const from = await heading(page, "Te esperan");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await expect(page.locator(".inboxsec.is-held")).toHaveCount(1);
    // Held, every section folds to its title.
    await expect(inbox.locator(".taskbundle:visible")).toHaveCount(0);
    const top = await heading(page, "En curso");
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x, from.y + ((top.y - 14 - from.y) * i) / 10);
    await page.screenshot({ path: info.outputPath("dragging-1280.png") });
    await page.mouse.up();
    const moved = ["Te esperan", "En curso", "Pendientes", "Listo", "Descartadas"];
    await expect.poll(() => headings(page)).toEqual(moved);
    const waiting = inbox.getByRole("region", { name: "Te esperan", exact: true });
    await expect(waiting.locator(".taskbundle")).toContainText("Section waiting");
    await expect(waiting.locator(".inboxsec__tasktoggle")).toHaveAttribute("aria-expanded", "true");
    await expect(inbox.locator(".taskbundle")).toHaveCount(5);
    await page.screenshot({ path: info.outputPath("moved-1280.png"), fullPage: true });
    await page.reload();
    // The open chat (Home) brings its own tab back as the panel loads: pick Tasks once that settles.
    const tasksTab = page.getByRole("region", { name: "Inbox", exact: true }).getByRole("radio", { name: /^Tareas/ });
    await expect(async () => {
      await tasksTab.click();
      expect(await headings(page)).toEqual(moved);
    }).toPass();
    const toggle = page.getByRole("button", { name: "Te esperan 1", exact: true });
    await toggle.focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => headings(page)).toEqual(DEFAULT);
    await expect(toggle).toBeFocused();
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("on a phone a long press on a title moves the section", async ({ page }, info) => {
  const env = await startCore({ port: 0, llm: scriptedLlm(() => say("Ready.")) });
  try {
    await everySection(env);
    const inbox = await openTasks(page, env, 390);
    await expect.poll(() => headings(page)).toEqual(DEFAULT);
    const url = page.url();
    const from = await heading(page, "Descartadas");
    const first = await heading(page, "En curso");
    await touchDrag(page, from, first.y - 14, info.outputPath("dragging-390.png"));
    await expect.poll(() => headings(page)).toEqual(["Descartadas", "En curso", "Te esperan", "Pendientes", "Listo"]);
    expect(page.url()).toBe(url);
    await expect(inbox.locator(".taskbundle")).toHaveCount(5);
    await page.screenshot({ path: info.outputPath("moved-390.png"), fullPage: true });
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
