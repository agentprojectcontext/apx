import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { expandHome, isInside, relativeWritten, samePath, tildeHome } from "./paths.ts";

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
  // A relative path is not under the home, whatever it resolves to from here.
  assert.equal(tildeHome("work/notes", home), "work/notes");
});

test("paths compare as the system does: resolved, and in any case on Windows", () => {
  const root = path.join(path.sep, "srv", "Acme");
  assert.ok(samePath(root, path.join(root, "notes", "..")));
  assert.ok(samePath(`${root}${path.sep}`, root));
  assert.ok(!samePath(root, `${root}-backup`));
  assert.equal(samePath(root, root.toUpperCase()), process.platform === "win32");
  assert.equal(isInside(root, path.join(root.toLowerCase(), "a.txt")), process.platform === "win32");
});

test("a path a command wrote on either system is said relative to its folder", () => {
  assert.equal(relativeWritten("D:\\Work\\Acme", "d:/work/acme/src/a.txt"), "src/a.txt");
  assert.equal(relativeWritten("D:/Work/Acme/", "D:\\Work\\Acme\\a.txt"), "a.txt");
  assert.equal(relativeWritten("/home/dev/acme", "/home/dev/acme/a.txt"), "a.txt");
  // Unix names differ by case, and a sibling that only starts with the name is outside.
  assert.equal(relativeWritten("/home/dev/acme", "/home/dev/ACME/a.txt"), undefined);
  assert.equal(relativeWritten("/home/dev/acme", "/home/dev/acme-old/a.txt"), undefined);
});
