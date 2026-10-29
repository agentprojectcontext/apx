import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mounted } from "./browser.test-support.ts";

test("tags accept pasted lists, deduplicate case-insensitively, enforce limits and support removal", async () =>
  mounted(async (page) => {
    const input = page.getByRole("textbox", { name: "Tags", exact: true });
    await input.fill(" Acme, acme, Northwind,Last");
    await input.press("Enter");
    await expect(page.getByTestId("tags")).toHaveText('["Acme","Northwind","Last"]');
    await input.fill("Overflow");
    await input.press("Enter");
    await expect(page.getByTestId("tags")).toHaveText('["Acme","Northwind","Last"]');
    await input.press("Backspace");
    await page.getByRole("button", { name: "Remove Acme", exact: true }).click();
    await input.fill("Blurred");
    await input.blur();
    await expect(page.getByTestId("tags")).toHaveText('["Northwind","Blurred"]');
  }));

test("suggestions replace only the current word with keyboard and mouse and Escape dismisses", async () =>
  mounted(async (page) => {
    const input = page.getByRole("textbox", { name: "Command", exact: true });
    await input.fill("echo $apx_");
    await expect(page.getByRole("button", { name: "$APX_HOME Home", exact: true })).toBeVisible();
    await input.press("ArrowUp");
    await input.press("Tab");
    await expect(input).toHaveValue("echo $APX_PORT");
    await input.fill("echo $");
    await input.press("Escape");
    await expect(page.locator(".apx-suggest__list")).toHaveCount(0);
    await input.fill("echo $APX_H");
    await page.getByRole("button", { name: "$APX_HOME Home", exact: true }).click();
    await expect(input).toHaveValue("echo $APX_HOME");
    await input.fill("echo $NO_MATCH");
    await expect(page.locator(".apx-suggest__list")).toHaveCount(0);
  }));

test("composer preserves newlines, sends queued text and clears only its uncontrolled draft", async () =>
  mounted(async (page) => {
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await page.getByRole("button", { name: "Voice", exact: true }).click();
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    await input.fill("First");
    await input.press("Shift+Enter");
    await input.press("End");
    await input.press("Control+Enter");
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("events")).toHaveText('["voice","attach",{"text":"First\\n","queue":true}]');
    await input.fill("Second");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("events")).toContainText('{"text":"Second","queue":false}');
    await page.getByRole("button", { name: "Send attachment", exact: true }).click();
    await expect(page.getByTestId("events")).toContainText('{"attachment":""}');
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByTestId("events")).toContainText('"stop"');
    await expect(page.getByRole("button", { name: "Voice", exact: true })).toBeVisible();
  }));

test("select groups expose disabled choices and selecting an enabled project updates its label", async () =>
  mounted(async (page) => {
    await page.getByRole("combobox", { name: "Project", exact: true }).click();
    await expect(page.getByRole("option", { name: /Northwind/ })).toBeDisabled();
    await page.getByRole("option", { name: /Acme/ }).click();
    await expect(page.getByRole("combobox", { name: "Project", exact: true })).toHaveText("Acme");
    await expect(page.getByTestId("selected")).toHaveText("a");
  }));

test("checkboxes, switches and segmented controls expose and update selection with keyboard", async () =>
  mounted(async (page) => {
    const checkbox = page.getByRole("checkbox", { name: "Select all", exact: true });
    await checkbox.focus();
    await checkbox.press("Space");
    await expect(checkbox).toBeChecked();
    const notifications = page.getByRole("switch", { name: "Notifications", exact: true });
    await notifications.click();
    await expect(notifications).toBeChecked();
    await expect(page.getByRole("switch", { name: "Locked", exact: true })).toBeDisabled();
    await page.getByRole("radio", { name: "Board", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Board", exact: true })).toBeChecked();
    await expect(page.getByRole("radio", { name: "List", exact: true })).not.toBeChecked();
    await expect(page.getByTestId("events")).toHaveText('[{"view":"board"}]');
  }));

test("splitter clamps keyboard and pointer resize, ends drag and resets on double click", async () =>
  mounted(async (page) => {
    const splitter = page.getByRole("separator", { name: "Resize sidebar", exact: true });
    await splitter.focus();
    await splitter.press("ArrowRight");
    await expect(splitter).toHaveAttribute("aria-valuenow", "256");
    for (let i = 0; i < 5; i++) await splitter.press("ArrowLeft");
    await expect(splitter).toHaveAttribute("aria-valuenow", "200");
    const rect = await splitter.boundingBox();
    assert.ok(rect);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId("dragging")).toHaveText("true");
    await page.mouse.move(rect.x + 200, rect.y + rect.height / 2);
    await page.mouse.up();
    await expect(splitter).toHaveAttribute("aria-valuenow", "300");
    await expect(page.getByTestId("dragging")).toHaveText("false");
    await splitter.dblclick();
    await expect(splitter).toHaveAttribute("aria-valuenow", "240");
  }));

test("browser tabs select by keyboard, close without selecting and create a new tab", async () =>
  mounted(async (page) => {
    const second = page.getByRole("tab", { name: "Northwind", exact: false });
    await second.focus();
    await second.press("Enter");
    await expect(second).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: /Acme/ }).getByRole("button", { name: "Close tab" }).click();
    await expect(page.getByRole("tab", { name: /Acme/ })).toHaveCount(0);
    await expect(page.getByTestId("tab")).toHaveText("b");
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(page.getByRole("tab", { name: /New page/ })).toBeVisible();
  }));

test("menus invoke enabled actions and dialogs return focus after dismissal and remount their content on reopening", async () =>
  mounted(async (page) => {
    await page.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Unavailable", exact: true })).toBeDisabled();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(page.getByTestId("events")).toHaveText('["archive"]');
    const trigger = page.getByRole("button", { name: "Edit project", exact: true });
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Project details", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Northwind");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Acme");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }));

test("date presets commit and close, clear restores the empty value, and action groups reveal failed details", async () =>
  mounted(async (page) => {
    await page.getByRole("button", { name: "Due date", exact: true }).click();
    await page.getByRole("button", { name: "Leap day", exact: true }).click();
    await expect(page.getByTestId("date")).toHaveText("2024-02-29");
    await expect(page.getByRole("button", { name: "Leap day", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByTestId("date")).toHaveText("None");
    await page.getByRole("button", { name: /Worked/ }).click();
    await expect(page.getByText("Refused", { exact: true })).toBeVisible();
    await expect(page.locator("li.apx-actions__item.is-failed")).toBeVisible();
  }));

test("agent cards choose by click and arrows, keep the chosen one in sight and show the rest on demand", async () =>
  mounted(async (page) => {
    const group = page.getByRole("radiogroup", { name: "Agent", exact: true });
    await expect(group.getByRole("radio")).toHaveCount(6);
    await expect(group.getByRole("radio", { name: /Agent 8/ })).toHaveAttribute("aria-checked", "true");
    await group.getByRole("radio", { name: /Agent 2/ }).click();
    await expect(page.getByTestId("agent")).toHaveText("a2");
    await group.getByRole("radio", { name: /Agent 2/ }).press("ArrowRight");
    await expect(page.getByTestId("agent")).toHaveText("a3");
    await page.getByRole("button", { name: "Show all 8", exact: true }).click();
    await expect(group.getByRole("radio")).toHaveCount(8);
  }));

test("a one-line template field keeps one line and offers a group's action when nothing is there yet", async () =>
  mounted(async (page) => {
    const field = page.getByRole("textbox", { name: "Row key", exact: true });
    await field.fill("lead");
    await field.press("Enter");
    await expect(page.getByTestId("key")).toHaveText('"lead"');
    await field.fill("");
    await field.pressSequentially("$tr");
    await field.press("Enter");
    await expect(page.getByTestId("key")).toHaveText('"$trigger.email"');
    await field.fill("");
    await field.pressSequentially("secret://");
    await page.getByRole("option", { name: "Save a secret" }).click();
    await expect(page.getByTestId("events")).toContainText("save secret");
  }));
