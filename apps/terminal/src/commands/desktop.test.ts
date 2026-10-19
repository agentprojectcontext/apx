import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopCandidates } from "./desktop.ts";

test("the desktop app is looked for where each installer puts it", () => {
  assert.deepEqual(desktopCandidates("darwin", {}, "/Users/user"), [
    "/Applications/APX.app",
    "/Users/user/Applications/APX.app",
  ]);
  const installed = [
    "C:\\Users\\u\\AppData\\Local\\Programs\\apx\\APX.exe",
    "C:\\Users\\u\\AppData\\Local\\Programs\\@apxdesktop\\APX.exe",
  ];
  assert.deepEqual(
    desktopCandidates("win32", { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "C:\\Users\\u"),
    installed,
  );
  assert.deepEqual(desktopCandidates("win32", {}, "C:\\Users\\u"), installed);
  assert.deepEqual(desktopCandidates("linux", {}, "/home/u"), ["/home/u/Applications/APX.AppImage"]);
});
