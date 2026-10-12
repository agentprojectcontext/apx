import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutAppLinks } from "./app-links.ts";

test("a channel message keeps an app link's label and drops where it pointed; web links stay", () => {
  assert.equal(
    withoutAppLinks("Prendelo en [Config › Escritorio](apx:settings/desktop)."),
    "Prendelo en Config › Escritorio.",
  );
  assert.equal(
    withoutAppLinks("[docs](https://example.com) y [tareas](APX:tasks)"),
    "[docs](https://example.com) y tareas",
  );
});
