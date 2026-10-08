import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceableBundle } from "./app-bundle.ts";

const all = () => true;

test("the app replaces its own bundle where the owner can write it", () => {
  assert.equal(replaceableBundle("/Applications/APX.app/Contents/MacOS/APX", all), "/Applications/APX.app");
  assert.equal(
    replaceableBundle("/Users/acme/Applications/APX 2.app/Contents/MacOS/APX", all),
    "/Users/acme/Applications/APX 2.app",
  );
});

test("not from a disk image, a translocated copy, a read-only place or a bare binary", () => {
  assert.equal(
    replaceableBundle("/Applications/APX.app/Contents/MacOS/APX", (dir) => dir !== "/Applications"),
    undefined,
  );
  assert.equal(
    replaceableBundle("/private/var/folders/x/AppTranslocation/1234/d/APX.app/Contents/MacOS/APX", all),
    undefined,
  );
  assert.equal(replaceableBundle("/usr/local/bin/apx", all), undefined);
});
