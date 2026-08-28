import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

// Regression for SURVEY-2026-08-17 findings 1.2/1.3: the Code module used to
// browse files by shelling out through the /run endpoint — CodeScreen even
// interpolated a user-controlled path into `cat "${path}"` (shell injection)
// and posted it to un-prefixed "/run", which the SPA fallback swallowed, so
// file-open was silently broken. Both surfaces must go through the sandboxed
// project-files API (lib/api/projectFiles.ts → /api/projects/:pid/fs/*).
// CodeTerminal is the one legitimate /api/run client: it IS a terminal.

const SCREEN = "src/interfaces/web/src/screens/modules/CodeScreen.tsx";
const TREE = "src/interfaces/web/src/components/code/CodeFileTree.tsx";
const TERMINAL = "src/interfaces/web/src/components/code/CodeTerminal.tsx";

test("CodeScreen opens files via ProjectFiles.read, not a shell command", () => {
  const src = read(SCREEN);
  assert.match(src, /ProjectFiles\.read\(/, "file-open must use the fs API");
  assert.doesNotMatch(src, /cat\s+"?\$\{/, "no path interpolation into a shell command");
  assert.doesNotMatch(src, /["'`]\/(api\/)?run["'`]/, "CodeScreen must not call the run endpoint");
});

test("CodeFileTree lists files via ProjectFiles.tree, not a find pipeline", () => {
  const src = read(TREE);
  assert.match(src, /ProjectFiles\.tree\(/, "tree must use the fs API");
  assert.doesNotMatch(src, /find \. -type f/, "no shelled find pipeline");
  assert.doesNotMatch(src, /["'`]\/(api\/)?run["'`]/, "CodeFileTree must not call the run endpoint");
});

test("CodeTerminal still talks to /api/run (it is the terminal)", () => {
  assert.match(read(TERMINAL), /["'`]\/api\/run["'`]/);
});

// ---------------------------------------------------------------------------
// The panel showed only the ACTIVE project's sessions, so a session started
// from any other cwd — every `apx exec --code` run — was invisible, with no
// hint that it existed. The list is now unfiltered by default and the project
// picker narrows it; the open session's project comes from the ROW, since an id
// alone does not address a session.

const SESSION_LIST = "src/interfaces/web/src/components/code/CodeSessionList.tsx";
const NEW_DIALOG = "src/interfaces/web/src/components/code/NewCodeSessionDialog.tsx";
const CODE_API = "src/interfaces/web/src/lib/api/code.ts";

test("the session list defaults to every project, and the picker is the filter", () => {
  const src = read(SCREEN);
  assert.match(src, /Code\.sessions\.listAll\(\)/, "the unfiltered list must be the default");
  assert.match(src, /filterPid \? Code\.sessions\.list\(filterPid\) : Code\.sessions\.listAll\(\)/);
  // The picker narrows the LIST; it must not be wired straight to the project
  // the open session runs in, which is what conflated the two.
  assert.match(src, /onChange=\{onFilterProject\}/);
});

test("selecting a session moves to the row's project, not the filter's", () => {
  const src = read(SCREEN);
  // A cross-project row carries its own pid; opening it with the project in
  // view would 404 or, worse, hit a same-id session elsewhere.
  assert.match(src, /const onSelectSession = \(row: CodeSessionRow\)/);
  assert.match(src, /setPid\(rowPid\(row\)\)/);
  assert.match(src, /Code\.sessions\.remove\(target\.pid, target\.id\)/);
});

test("the cross-project route is the one the client calls for the full list", () => {
  assert.match(read(CODE_API), /["'`]\/api\/code\/sessions["'`]/);
});

test("agent choice lives at session creation, not in a rail dropdown", () => {
  const dialog = read(NEW_DIALOG);
  assert.match(dialog, /agentSlug/, "the dialog must carry the agent");
  assert.match(dialog, /allowAll=\{false\}/, "a new session has to land in a project");

  // The old rail control read as a global "who am I talking to" while silently
  // re-pointing whichever session was open. It must not come back.
  const src = read(SCREEN);
  assert.doesNotMatch(
    src,
    /<UiSelect[\s\S]{0,200}?onChange=\{onAgentChange\}/,
    "the agent selector belongs in the dialog and the session's Context panel"
  );
  assert.match(src, /<NewCodeSessionDialog/);
});

test("session rows name their project and their agent", () => {
  const src = read(SESSION_LIST);
  assert.match(src, /s\.projectName/, "a cross-project list must say which project");
  assert.match(src, /s\.agentSlug/, "and who answers in the session");
});
