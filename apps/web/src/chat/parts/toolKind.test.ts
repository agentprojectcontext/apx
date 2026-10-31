import assert from "node:assert/strict";
import { test } from "node:test";
import { stepLabel, toolKind } from "./toolKind.ts";

test("each step shows the icon of its kind of action", () => {
  assert.equal(toolKind("web_search"), "web");
  assert.equal(toolKind("browser_click"), "web");
  assert.equal(toolKind("file_read"), "read");
  assert.equal(toolKind("file_write"), "write");
  assert.equal(toolKind("remember"), "memory");
  assert.equal(toolKind("shell_output"), "command");
  assert.equal(toolKind("screen_click"), "computer");
  assert.equal(toolKind("gmail_send"), "mail");
  assert.equal(toolKind("calendar_events"), "calendar");
  assert.equal(toolKind("delegate"), "agents");
});

test("a tool APX does not know is a plain tool", () => {
  assert.equal(toolKind("acme_lookup"), "tool");
  assert.equal(toolKind(""), "tool");
});

test("a step reads as words, never as a tool's id", () => {
  assert.equal(stepLabel("browser_open", "Abrió acme.com"), "Abrió acme.com");
  assert.equal(stepLabel("acme_lookup", "acme_lookup"), "Acme lookup");
  assert.equal(stepLabel("mcp_northwind__find_order", "mcp_northwind__find_order"), "Northwind find order");
  assert.equal(stepLabel("crm.query", ""), "Crm query");
});
