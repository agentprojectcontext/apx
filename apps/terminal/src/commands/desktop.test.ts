import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopCandidates } from "./desktop.ts";

test("the desktop app is looked for where each installer puts it", () => {
  assert.deepEqual(desktopCandidates("darwin", {}, "/Users/user"), [
    "/Applications/APX.app",
    "/Users/user/Applications/APX.app",
  ]);
  assert.ok(
    desktopCandidates("win32", { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "C:\\Users\\u")[0]?.endsWith(
      "APX.exe",
    ),
  );
  assert.deepEqual(desktopCandidates("linux", {}, "/home/u"), ["/home/u/Applications/APX.AppImage"]);
});
