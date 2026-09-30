// edit_file replaces TEXT. String.prototype.replace with a string replacement
// reads `$&`, `$'`, `$$` as patterns, so an edit whose new code contained one
// (shell, regex, template literals) wrote something the model never asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import editFile from "#core/agent/tools/handlers/edit-file.js";

test("edit_file writes the replacement literally, `$` sequences included", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-edit-literal-"));
  fs.writeFileSync(path.join(dir, "run.sh"), "echo OLD\n");
  const projects = { get: () => ({ id: 0, path: dir }), list: () => [{ id: 0 }] };
  const edit = editFile.makeHandler({ projects, requirePermission: async () => {} });
  const replacement = "echo \"$$ $& $' $1\"";
  await edit({ path: "run.sh", search: "echo OLD", replace: replacement });
  assert.equal(fs.readFileSync(path.join(dir, "run.sh"), "utf8"), `${replacement}\n`);
});
