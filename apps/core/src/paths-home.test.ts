import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { expandHome, tildeHome } from "./paths.ts";

test("a path under the home shows as ~ and reads back, and nothing else changes", () => {
  const home = path.join(path.sep, "home", "alex");
  const inside = path.join(home, "work", "extensions", "daily-brief");
  assert.equal(tildeHome(inside, home), `~${path.sep}${path.join("work", "extensions", "daily-brief")}`);
  assert.equal(expandHome(tildeHome(inside, home), home), inside);
  assert.equal(tildeHome(home, home), "~");
  // A folder that only starts with the home's name is not inside it.
  assert.equal(tildeHome(`${home}-backup`, home), `${home}-backup`);
  assert.equal(expandHome("~alex/notes", home), "~alex/notes");
  assert.equal(expandHome("/srv/apx", home), "/srv/apx");
});
