// Usability guards over the main screens: every control has a name a screen reader can say, and on a phone-sized
// window nothing scrolls sideways.
import { expect, open, test } from "./kit.ts";

const SCREENS: Array<[string, Array<[role: "button" | "tab", name: string | RegExp]>]> = [
  ["inbox", []],
  ["tasks", [["button", "Tareas"]]],
  ["project", [["button", /^Northwind/]]],
  [
    "team",
    [
      ["button", /^Northwind/],
      ["tab", /^Agentes/],
    ],
  ],
  [
    "files",
    [
      ["button", /^acme/i],
      ["tab", "Archivos"],
    ],
  ],
  ["resources", [["button", "Recursos"]]],
  ["telegram", [["button", "Telegram"]]],
  ["engine", [["button", "Claude Code"]]],
];

for (const [name, clicks] of SCREENS)
  test(`${name}: every control has an accessible name`, async ({ page }) => {
    await open(page);
    for (const [role, label] of clicks)
      await page
        .getByRole(role, { name: label, exact: typeof label === "string" })
        .first()
        .click();
    await page.waitForTimeout(300);
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button,[role=button],[role=tab],[role=radio],input,textarea,select")]
        .filter((el) => {
          const e = el as HTMLElement;
          if (!e.offsetParent || (e as HTMLInputElement).type === "hidden") return false;
          const labelled =
            e.getAttribute("aria-label") ||
            e.getAttribute("aria-labelledby") ||
            e.getAttribute("title") ||
            (e.id && document.querySelector(`label[for="${e.id}"]`)) ||
            e.closest("label") ||
            (e.tagName === "BUTTON" || e.getAttribute("role") ? (e.innerText ?? "").trim() : "") ||
            [...e.querySelectorAll("img[alt]")].some((i) => i.getAttribute("alt"));
          return !labelled;
        })
        .map((e) => e.outerHTML.slice(0, 120)),
    );
    expect(unnamed).toEqual([]);
  });

test("on a phone-sized window nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  for (const label of ["Tareas", "Recursos"]) {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(0);
    const nav = page.getByRole("button", { name: label, exact: true }).first();
    if (await nav.isVisible()) await nav.click();
  }
});

test("on a phone the chat header's subtitle stops before its tools", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "#thread=home");
  const header = page.locator(".chat__header");
  const subtitle = header.locator(".chat__crumb .chat__agentbtn");
  await expect(subtitle).toBeVisible();
  const right = (await subtitle.boundingBox()) ?? { x: 0, width: 0 };
  const tools = (await header.locator(".chat__tools").boundingBox()) ?? { x: 0 };
  expect(right.x + right.width).toBeLessThanOrEqual(tools.x);
  // Cut short, not overflowing: what does not fit ends in an ellipsis.
  await expect(subtitle).toHaveCSS("text-overflow", "ellipsis");
});
