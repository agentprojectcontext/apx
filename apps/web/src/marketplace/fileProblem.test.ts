import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { fileProblem } from "./fileProblem.ts";

test("file recovery uses typed detail, not diagnostic text", () => {
  for (const [reason, key] of Object.entries({
    missing: "mkt.fileMissing",
    unreadable: "mkt.fileUnreadable",
    invalid_sqlite: "mkt.fileInvalidSqlite",
    active_sqlite: "mkt.fileActiveSqlite",
  })) {
    assert.deepEqual(
      fileProblem(
        new ApxError({
          code: "bad_request",
          message: "opaque",
          detail: { kind: "setting_file", setting: "backup", reason },
        }),
      ),
      { setting: "backup", key },
    );
  }
  assert.equal(fileProblem(new Error("no file at /backup.sqlite")), undefined);
  assert.equal(
    fileProblem(
      new ApxError({
        code: "bad_request",
        message: "opaque",
        detail: { kind: "setting_file", setting: "backup", reason: "unknown" },
      }),
    ),
    undefined,
  );
});
