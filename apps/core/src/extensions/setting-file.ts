import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { ExtensionSetting } from "@apx/protocol";
import { badRequest } from "../errors.ts";

/** Validate a host file without creating it or returning its path in a failure. */
export function checkSettingFile(s: ExtensionSetting, file: string): void {
  const fail = (reason: "missing" | "unreadable" | "invalid_sqlite" | "active_sqlite"): never => {
    throw badRequest("Choose an existing, readable file", { kind: "setting_file", setting: s.name, reason });
  };
  try {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) fail("missing");
    if (s.fileFormat !== "sqlite") {
      fs.accessSync(file, fs.constants.R_OK);
      return;
    }
    if (["-wal", "-shm", "-journal"].some((suffix) => fs.existsSync(`${file}${suffix}`))) fail("active_sqlite");
    const fd = fs.openSync(file, "r");
    const header = Buffer.alloc(100);
    let bytes: number;
    try {
      bytes = fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (bytes !== 100 || header.subarray(0, 16).toString("binary") !== "SQLite format 3\0") fail("invalid_sqlite");
    if (header[18] !== 1 || header[19] !== 1) fail("active_sqlite");
    let db: DatabaseSync | undefined;
    try {
      const uri = pathToFileURL(file);
      uri.searchParams.set("immutable", "1");
      // Immutable opens cannot create sidecars, even if another process changes the source after our checks.
      db = new DatabaseSync(uri, { readOnly: true, allowExtension: false });
      db.prepare("SELECT name FROM sqlite_schema LIMIT 1").get();
    } catch {
      fail("invalid_sqlite");
    } finally {
      db?.close();
    }
  } catch (error) {
    if (error && typeof error === "object" && "shape" in error) throw error;
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    fail(code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable");
  }
}
