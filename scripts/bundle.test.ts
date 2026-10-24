import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { removeDir, tempDir } from "../apps/core/src/testkit/platform.ts";
import { bootFiles, bootProblems, bootReport, moduleBytes, owner } from "./bundle.ts";

/** A built panel: an entry that imports a shared chunk, a lazy screen and two language chunks. */
function dist(files: Record<string, string>): string {
  const dir = tempDir("apx-bundle-").path;
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    '<script type="module" src="/assets/index-A.js"></script><link rel="stylesheet" href="/assets/index-B.css">',
  );
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  return dir;
}

const panel = {
  "assets/index-A.js":
    'import{a}from"./shared-C.js";const en=()=>import(`./en-D.js`),es=()=>import("./es-E.js"),p=()=>import("./ProjectScreen-F.js");',
  "assets/index-B.css": "body{}",
  "assets/shared-C.js": "export const a=1;",
  "assets/en-D.js": 'import"./notices-G.js";export const en={};',
  "assets/es-E.js": 'import"./notices-G.js";export const es={"k":"una cadena bastante más larga que la inglesa"};',
  "assets/notices-G.js": "export const n={};",
  "assets/ProjectScreen-F.js": "export function ProjectScreen(){}",
  "assets/src-H.js": 'class Z{static n="$ZodType"}',
};

test("the first load is the entry, its static imports and the heavier language with its own imports", (t) => {
  const dir = dist(panel);
  t.after(() => removeDir(dir));
  const boot = bootFiles(dir);
  assert.ok(boot);
  assert.deepEqual(boot.initial.sort(), ["assets/index-A.js", "assets/index-B.css", "assets/shared-C.js"]);
  assert.deepEqual(boot.languages.en?.sort(), ["assets/en-D.js", "assets/notices-G.js"]);
  assert.deepEqual(boot.files.slice(3).sort(), ["assets/es-E.js", "assets/notices-G.js"]);
  assert.deepEqual(bootProblems(dir, boot, ["ProjectScreen"]), []);
  assert.equal(bootFiles(path.join(dir, "missing")), undefined);
});

test("zod or a lazy screen pulled onto the first load is named", (t) => {
  // The language imports the protocol's barrel, and a static import merged ProjectScreen into the entry.
  const { "assets/ProjectScreen-F.js": _merged, ...rest } = panel;
  const dir = dist({ ...rest, "assets/en-D.js": 'import"./notices-G.js";import"./src-H.js";export const en={};' });
  t.after(() => removeDir(dir));
  const boot = bootFiles(dir);
  assert.ok(boot);
  assert.deepEqual(bootProblems(dir, boot, ["ProjectScreen"]), [
    "zod is on the first load: import a subpath of @apx/protocol that has no schemas",
    "ProjectScreen has no chunk of its own: something on the first screen imports it",
  ]);
});

test("a sourcemap names the packages and files that weigh the most", (t) => {
  const dir = dist({
    ...panel,
    "assets/shared-C.js": "var a=1;",
    // Columns 0-3 come from zod, 4-7 from the panel's own file.
    "assets/shared-C.js.map": JSON.stringify({
      version: 3,
      sources: ["../../../node_modules/.pnpm/zod@4.0.0/node_modules/zod/v4/core.js", "../../src/a.ts"],
      mappings: "AAAA,ICAA",
    }),
  });
  t.after(() => removeDir(dir));
  const bytes = moduleBytes(dir, "assets/shared-C.js");
  assert.equal(bytes?.get("zod"), 4);
  assert.equal(bytes?.size, 2);
  const boot = bootFiles(dir);
  assert.ok(boot);
  // index-A.js has no map: the report says how to get one instead of naming nothing.
  assert.match(bootReport(dir, boot), /APX_TEST_COVERAGE=1/);
  assert.match(bootReport(dir, boot), /KB gz {2}assets\/es-E\.js/);
});

test("a source file belongs to its npm package, a workspace package's build or its repo path", () => {
  assert.equal(
    owner("/r/node_modules/.pnpm/@base-ui+react@1.8.0/node_modules/@base-ui/react/esm/x.js"),
    "@base-ui/react",
  );
  assert.equal(owner("/r/node_modules/react-dom/cjs/react-dom.js"), "react-dom");
  assert.equal(owner("/r/packages/ui/dist/chunk-X.js"), "@apx/ui");
  assert.equal(owner("/r/apps/web/src/i18n/es.ts"), "apps/web/src/i18n/es.ts");
  // A path resolved on Windows.
  assert.equal(owner("D:\\r\\node_modules\\.pnpm\\zod@4.0.0\\node_modules\\zod\\v4\\core.js"), "zod");
  assert.equal(owner("D:\\r\\apps\\web\\src\\a.ts"), "apps/web/src/a.ts");
});
