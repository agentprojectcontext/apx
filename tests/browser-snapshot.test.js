import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget, renderSnapshot, pruneEmptyContainers } from "#core/http-tools/browser.js";
import { TOOL_DEFINITIONS } from "#core/http-tools/catalog.js";

test("resolveTarget turns a snapshot ref into an attribute selector", () => {
  assert.equal(resolveTarget({ ref: "ref_12" }), '[data-apx-ref="ref_12"]');
  assert.equal(resolveTarget({ ref: " ref_3 " }), '[data-apx-ref="ref_3"]');
});

test("resolveTarget prefers the ref when both addressing modes are given", () => {
  assert.equal(resolveTarget({ ref: "ref_1", selector: "#other" }), '[data-apx-ref="ref_1"]');
});

test("resolveTarget falls back to the selector, and to null when neither is usable", () => {
  assert.equal(resolveTarget({ selector: "button#submit" }), "button#submit");
  assert.equal(resolveTarget({}), null);
  assert.equal(resolveTarget({ ref: "", selector: "  " }), null);
});

test("resolveTarget rejects a ref that did not come from a snapshot", () => {
  // A model that invents "#submit" or "ref-12" must be told, not silently
  // handed a selector that matches nothing.
  for (const bad of ["#submit", "ref-12", "12", "ref_", "ref_1; DROP"]) {
    assert.throws(() => resolveTarget({ ref: bad }), /invalid ref/, `should reject: ${bad}`);
  }
});

test("renderSnapshot writes one screen-reader line per node, indented by depth", () => {
  const out = renderSnapshot([
    { depth: 0, role: "heading", name: "Iniciar sesión", level: 1 },
    { depth: 0, role: "form" },
    { depth: 1, ref: "ref_1", role: "textbox", name: "Email", type: "email", required: true },
    { depth: 1, ref: "ref_2", role: "checkbox", name: "Recordarme", checked: true },
    { depth: 1, ref: "ref_3", role: "button", name: "Entrar", disabled: true },
    { depth: 0, ref: "ref_4", role: "link", name: "Reset", href: "/reset" },
  ]);
  assert.equal(out, [
    '- heading "Iniciar sesión" {level=1}',
    "- form",
    '  - textbox "Email" [ref_1] {type=email required}',
    '  - checkbox "Recordarme" [ref_2] {checked}',
    '  - button "Entrar" [ref_3] {disabled}',
    '- link "Reset" [ref_4] {href=/reset}',
  ].join("\n"));
});

test("renderSnapshot clips at the char budget and says how much it dropped", () => {
  const nodes = Array.from({ length: 50 }, (_, i) => ({ depth: 0, ref: `ref_${i}`, role: "button", name: `b${i}` }));
  const out = renderSnapshot(nodes, { maxChars: 120 });
  assert.ok(out.length < 400, "stays near the budget");
  assert.match(out, /more nodes omitted/);
});

test("pruneEmptyContainers drops nameless structure that holds nothing", () => {
  const kept = pruneEmptyContainers([
    { depth: 0, role: "table" },            // has a child below → kept
    { depth: 1, ref: "ref_1", role: "link", name: "x" },
    { depth: 0, role: "row" },              // nothing deeper follows → dropped
    { depth: 0, role: "row" },              // last node, nameless → dropped
  ]);
  assert.deepEqual(kept.map((n) => n.role), ["table", "link"]);
});

test("pruneEmptyContainers never drops a node that carries a ref or a name", () => {
  const nodes = [
    { depth: 0, ref: "ref_1", role: "button", name: "" },
    { depth: 0, role: "navigation", name: "Principal" },
  ];
  assert.deepEqual(pruneEmptyContainers(nodes), nodes);
});

test("browser_snapshot is in the catalog and reachable over HTTP", () => {
  const entry = TOOL_DEFINITIONS.find((t) => t.name === "browser_snapshot");
  assert.ok(entry, "browser_snapshot must be catalogued or no agent can call it");
  assert.equal(entry.category, "browser");
  assert.deepEqual(entry.endpoint, { method: "POST", path: "/api/tools/browser/snapshot" });
});

test("every browser action tool accepts a ref, and none of them still demands a selector", () => {
  for (const name of ["browser_click", "browser_type", "browser_select", "browser_hover"]) {
    const entry = TOOL_DEFINITIONS.find((t) => t.name === name);
    assert.ok(entry.parameters.properties.ref, `${name} must take a ref`);
    assert.ok(
      !(entry.parameters.required || []).includes("selector"),
      `${name} must not require a selector — a ref is the preferred address`
    );
  }
});
