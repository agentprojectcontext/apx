// Make sure the central TOOLS / NATIVE_TOOL_NAMES / CODE_PLAN_TOOLS exports
// stay in sync with the real handler files under core/agent/tools/handlers/.
// A drift here is the kind of thing that ships silently until somebody hits
// the wrong tool surface in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOOLS,
  NATIVE_TOOL_NAMES,
  CODE_PLAN_TOOLS,
  CODE_BUILD_TOOLS,
} from "#core/agent/tools/names.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLERS_DIR = path.resolve(__dirname, "..", "src", "core", "agent", "tools", "handlers");

function readHandlerExportedNames() {
  const out = new Set();
  for (const f of fs.readdirSync(HANDLERS_DIR)) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(HANDLERS_DIR, f), "utf8");
    // Every handler exports default { name: "<snake>", schema: {...}, makeHandler: ... }.
    // The first line that matches is the on-wire name.
    const m = src.match(/^\s*name:\s*"([a-z_][a-z0-9_]*)"/m);
    if (m) out.add(m[1]);
  }
  return out;
}

test("every handler file declares a tool name that lives in NATIVE_TOOL_NAMES", () => {
  const handlerNames = readHandlerExportedNames();
  assert.ok(handlerNames.size >= 25, `expected at least 25 handlers, got ${handlerNames.size}`);
  for (const name of handlerNames) {
    assert.ok(
      NATIVE_TOOL_NAMES.has(name),
      `handler "${name}" is missing from NATIVE_TOOL_NAMES (add it to core/agent/tools/names.js)`,
    );
  }
});

test("every name in TOOLS appears either as a handler or as a known bridged tool", () => {
  const handlerNames = readHandlerExportedNames();
  const bridgedOnly = new Set([TOOLS.GREP, TOOLS.GLOB, TOOLS.FETCH, TOOLS.SEARCH]);
  for (const [key, value] of Object.entries(TOOLS)) {
    if (bridgedOnly.has(value)) continue;
    assert.ok(
      handlerNames.has(value),
      `TOOLS.${key} = "${value}" has no matching handler under core/agent/tools/handlers/`,
    );
  }
});

test("TOOLS values are snake_case (the on-wire shape)", () => {
  for (const [key, value] of Object.entries(TOOLS)) {
    assert.match(value, /^[a-z][a-z0-9_]*$/, `TOOLS.${key} ("${value}") is not snake_case`);
  }
});

test("CODE_PLAN_TOOLS is read-only-ish — no mutation/side-effect tools", () => {
  const forbidden = [
    TOOLS.WRITE_FILE,
    TOOLS.EDIT_FILE,
    TOOLS.RUN_SHELL,
    TOOLS.CALL_AGENT,
    TOOLS.CALL_RUNTIME,
    TOOLS.SEND_TELEGRAM,
    TOOLS.SET_IDENTITY,
    TOOLS.SET_PERMISSION_MODE,
    TOOLS.IMPORT_AGENT,
    TOOLS.ADD_PROJECT,
    TOOLS.CREATE_TASK,
    TOOLS.REMEMBER,
  ];
  for (const t of forbidden) {
    assert.ok(!CODE_PLAN_TOOLS.includes(t), `CODE_PLAN_TOOLS leaked the mutation tool "${t}"`);
  }
});

test("CODE_BUILD_TOOLS is the unrestricted sentinel ('*')", () => {
  assert.equal(CODE_BUILD_TOOLS, "*");
});

test("CODE_PLAN_TOOLS entries are all in TOOLS (no string typos)", () => {
  const allValues = new Set(Object.values(TOOLS));
  for (const t of CODE_PLAN_TOOLS) {
    assert.ok(allValues.has(t), `CODE_PLAN_TOOLS has "${t}" which is not in TOOLS — typo?`);
  }
});
